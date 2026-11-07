/* Gerenciador de armazenamento: análise de uso por pasta/tipo, maiores arquivos,
 * sugestões de limpeza e jogos/apps instalados. */
#include "nimbo.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dirent.h>
#include <unistd.h>
#include <sys/stat.h>

typedef struct fitem { char *name; int64_t size; } fitem_t;
typedef struct dnode {
  char *name;
  int64_t size, files;
  struct dnode *parent;
  struct dnode **kids; int nk, ck;
  fitem_t top[12]; int ntop;           /* maiores arquivos diretamente nesta pasta */
} dnode_t;

enum { C_VIDEO, C_ARCHIVE, C_PACKAGE, C_AUDIO, C_IMAGE, C_PARTIAL, C_OTHER, C_N };
static const char *CAT_KEY[C_N] = { "video", "archive", "package", "audio", "image", "partial", "other" };
static const char *CAT_LABEL[C_N] = { "Vídeos", "Compactados", "Pacotes e imagens", "Áudio", "Imagens", "Downloads parciais", "Outros" };

#define TOPN 40
#define MAXSUG 60
static pthread_mutex_t lk = PTHREAD_MUTEX_INITIALIZER;
static struct {
  char *state;            /* idle running done canceled error */
  char *path, *error;
  int64_t files, bytes;
  double started, finished;
  volatile bool cancel;
  int gen;
  dnode_t *root;
  int64_t cat[C_N];
  fitem_t top[TOPN]; int ntop;           /* caminho completo */
  fitem_t sug[MAXSUG]; char *sug_reason[MAXSUG]; int nsug;
} A;

static int category(const char *name) {
  if (str_ends_with_ci(name, ".nimbopart")) return C_PARTIAL;
  static const char *v[] = { ".mkv", ".mp4", ".avi", ".m4v", ".mov", ".webm", ".ts", ".wmv", ".m2ts", ".mpg", NULL };
  static const char *p[] = { ".pkg", ".exfat", ".ffpkg", ".ffpfs", ".iso", ".img", ".bin", ".pfs", NULL };
  static const char *a[] = { ".mp3", ".flac", ".m4a", ".ogg", ".wav", ".aac", ".opus", NULL };
  static const char *im[] = { ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", NULL };
  for (int i = 0; v[i]; i++) if (str_ends_with_ci(name, v[i])) return C_VIDEO;
  if (archive_kind(name) != ARC_NONE) return C_ARCHIVE;
  for (int i = 0; p[i]; i++) if (str_ends_with_ci(name, p[i])) return C_PACKAGE;
  for (int i = 0; a[i]; i++) if (str_ends_with_ci(name, a[i])) return C_AUDIO;
  for (int i = 0; im[i]; i++) if (str_ends_with_ci(name, im[i])) return C_IMAGE;
  return C_OTHER;
}

static void top_insert(fitem_t *arr, int *n, int cap, const char *name, int64_t size) {
  if (*n == cap && arr[cap - 1].size >= size) return;
  int pos = *n < cap ? (*n)++ : cap - 1;
  if (pos == cap - 1 && *n == cap) free(arr[pos].name);
  while (pos > 0 && arr[pos - 1].size < size) { arr[pos] = arr[pos - 1]; pos--; }
  arr[pos].name = xstrdup(name);
  arr[pos].size = size;
}

static void free_node(dnode_t *d) {
  if (!d) return;
  for (int i = 0; i < d->nk; i++) free_node(d->kids[i]);
  for (int i = 0; i < d->ntop; i++) free(d->top[i].name);
  free(d->kids); free(d->name); free(d);
}

static void add_sug_locked(const char *path, int64_t size, const char *reason) {
  if (A.nsug >= MAXSUG) return;
  A.sug[A.nsug].name = xstrdup(path);
  A.sug[A.nsug].size = size;
  A.sug_reason[A.nsug] = xstrdup(reason);
  A.nsug++;
}

static int64_t scan(dnode_t *node, const char *path, int depth) {
  DIR *d = opendir(path);
  if (!d) return 0;
  struct dirent *e;
  int64_t total = 0;
  while (!A.cancel && (e = readdir(d))) {
    if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
    char *full = path_join(path, e->d_name);
    struct stat st;
    if (lstat(full, &st) == 0) {
      if (S_ISDIR(st.st_mode) && depth < 64) {
        dnode_t *k = calloc(1, sizeof *k);
        k->name = xstrdup(e->d_name);
        k->parent = node;
        if (node->nk == node->ck) { node->ck = node->ck ? node->ck * 2 : 8; node->kids = realloc(node->kids, node->ck * sizeof(dnode_t *)); }
        node->kids[node->nk++] = k;
        total += scan(k, full, depth + 1);
        node->files += k->files;
      } else if (S_ISREG(st.st_mode)) {
        int64_t sz = st.st_size;
        total += sz;
        node->files++;
        top_insert(node->top, &node->ntop, 12, e->d_name, sz);
        int c = category(e->d_name);
        pthread_mutex_lock(&lk);
        A.files++;
        A.bytes += sz;
        A.cat[c] += sz;
        top_insert(A.top, &A.ntop, TOPN, full, sz);
        if (c == C_PARTIAL) {
          char *fin = xstrdup(full);
          fin[strlen(fin) - strlen(".nimbopart")] = 0;
          if (!dl_path_pending(fin)) add_sug_locked(full, sz, "Download parcial abandonado");
          free(fin);
        } else if (c == C_ARCHIVE) {
          char *first = archive_first_volume(full);
          if (first) {
            char *base = archive_strip_ext(path_basename(first));
            char *dir = path_dirname(full);
            char *out = path_join(dir, base);
            if (is_dir(out)) add_sug_locked(full, sz, "Compactado que parece já ter sido extraído");
            free(out); free(dir); free(base); free(first);
          }
        }
        pthread_mutex_unlock(&lk);
      }
    }
    free(full);
  }
  closedir(d);
  node->size = total;
  return total;
}

static void *scan_thread(void *arg) {
  int gen = (int)(intptr_t)arg;
  pthread_mutex_lock(&lk);
  char *path = xstrdup(A.path);
  pthread_mutex_unlock(&lk);
  dnode_t *root = calloc(1, sizeof *root);
  root->name = xstrdup(path);
  scan(root, path, 0);
  pthread_mutex_lock(&lk);
  if (gen == A.gen) {
    free_node(A.root);
    A.root = root;
    free(A.state);
    A.state = xstrdup(A.cancel ? "canceled" : "done");
    A.finished = now_sec();
    root = NULL;
  }
  pthread_mutex_unlock(&lk);
  free_node(root);
  free(path);
  return NULL;
}

static void reset_locked(void) {
  free_node(A.root); A.root = NULL;
  for (int i = 0; i < A.ntop; i++) free(A.top[i].name);
  for (int i = 0; i < A.nsug; i++) { free(A.sug[i].name); free(A.sug_reason[i]); }
  A.ntop = A.nsug = 0;
  memset(A.cat, 0, sizeof A.cat);
  A.files = A.bytes = 0;
}

int analyze_start(const char *path, char **err) {
  char *np = storage_resolve(path, err);
  if (!np) return -1;
  if (!is_dir(np)) { free(np); *err = xstrdup("Pasta não encontrada"); return -1; }
  pthread_mutex_lock(&lk);
  A.cancel = true;         /* encerra uma análise anterior */
  pthread_mutex_unlock(&lk);
  msleep(50);
  pthread_mutex_lock(&lk);
  reset_locked();
  A.cancel = false;
  free(A.path); A.path = np;
  free(A.state); A.state = xstrdup("running");
  free(A.error); A.error = xstrdup("");
  A.started = now_sec();
  A.finished = 0;
  int gen = ++A.gen;
  pthread_mutex_unlock(&lk);
  pthread_t t;
  pthread_create(&t, NULL, scan_thread, (void *)(intptr_t)gen);
  pthread_detach(t);
  return 0;
}

void analyze_cancel(void) {
  pthread_mutex_lock(&lk);
  A.cancel = true;
  pthread_mutex_unlock(&lk);
}

cJSON *analyze_status(void) {
  cJSON *o = cJSON_CreateObject();
  pthread_mutex_lock(&lk);
  cJSON_AddStringToObject(o, "state", A.state ? A.state : "idle");
  cJSON_AddStringToObject(o, "path", A.path ? A.path : "");
  cJSON_AddNumberToObject(o, "files", (double)A.files);
  cJSON_AddNumberToObject(o, "bytes", (double)A.bytes);
  cJSON_AddNumberToObject(o, "elapsed", A.started ? ((A.finished ? A.finished : now_sec()) - A.started) : 0);
  cJSON *cats = cJSON_AddArrayToObject(o, "categories");
  for (int i = 0; i < C_N; i++) {
    if (!A.cat[i]) continue;
    cJSON *c = cJSON_CreateObject();
    cJSON_AddStringToObject(c, "key", CAT_KEY[i]);
    cJSON_AddStringToObject(c, "label", CAT_LABEL[i]);
    cJSON_AddNumberToObject(c, "bytes", (double)A.cat[i]);
    cJSON_AddItemToArray(cats, c);
  }
  cJSON *top = cJSON_AddArrayToObject(o, "top_files");
  for (int i = 0; i < A.ntop; i++) {
    cJSON *f = cJSON_CreateObject();
    cJSON_AddStringToObject(f, "path", A.top[i].name);
    cJSON_AddStringToObject(f, "name", path_basename(A.top[i].name));
    cJSON_AddNumberToObject(f, "size", (double)A.top[i].size);
    cJSON_AddItemToArray(top, f);
  }
  cJSON *sug = cJSON_AddArrayToObject(o, "suggestions");
  for (int i = 0; i < A.nsug; i++) {
    if (!file_exists(A.sug[i].name)) continue;   /* já apagado */
    cJSON *f = cJSON_CreateObject();
    cJSON_AddStringToObject(f, "path", A.sug[i].name);
    cJSON_AddStringToObject(f, "name", path_basename(A.sug[i].name));
    cJSON_AddNumberToObject(f, "size", (double)A.sug[i].size);
    cJSON_AddStringToObject(f, "reason", A.sug_reason[i]);
    cJSON_AddItemToArray(sug, f);
  }
  if (A.path) {
    cJSON_AddNumberToObject(o, "disk_free", (double)disk_free(A.path));
    cJSON_AddNumberToObject(o, "disk_total", (double)disk_total(A.path));
  }
  pthread_mutex_unlock(&lk);
  return o;
}

static int cmp_node(const void *a, const void *b) {
  int64_t x = (*(dnode_t **)a)->size, y = (*(dnode_t **)b)->size;
  return x < y ? 1 : x > y ? -1 : 0;
}

cJSON *analyze_dir(const char *path, char **err) {
  pthread_mutex_lock(&lk);
  if (!A.root || !A.path) { pthread_mutex_unlock(&lk); *err = xstrdup("Faça uma análise primeiro"); return NULL; }
  size_t rl = strlen(A.path);
  if (strncmp(path, A.path, rl) || (path[rl] && path[rl] != '/')) {
    pthread_mutex_unlock(&lk);
    *err = xstrdup("Pasta fora da análise atual");
    return NULL;
  }
  dnode_t *n = A.root;
  char *rest = xstrdup(path + rl);
  char *save = NULL;
  for (char *t = strtok_r(rest, "/", &save); t && n; t = strtok_r(NULL, "/", &save)) {
    dnode_t *f = NULL;
    for (int i = 0; i < n->nk; i++) if (!strcmp(n->kids[i]->name, t)) f = n->kids[i];
    n = f;
  }
  free(rest);
  if (!n) { pthread_mutex_unlock(&lk); *err = xstrdup("Pasta não encontrada na análise"); return NULL; }
  cJSON *o = cJSON_CreateObject();
  cJSON_AddStringToObject(o, "path", path);
  cJSON_AddStringToObject(o, "root", A.path);
  cJSON_AddNumberToObject(o, "size", (double)n->size);
  cJSON_AddNumberToObject(o, "files", (double)n->files);
  dnode_t **kids = malloc((n->nk + 1) * sizeof(dnode_t *));
  memcpy(kids, n->kids, n->nk * sizeof(dnode_t *));
  qsort(kids, n->nk, sizeof(dnode_t *), cmp_node);
  cJSON *dirs = cJSON_AddArrayToObject(o, "dirs");
  for (int i = 0; i < n->nk && i < 60; i++) {
    cJSON *d = cJSON_CreateObject();
    cJSON_AddStringToObject(d, "name", kids[i]->name);
    char *pp = path_join(path, kids[i]->name);
    cJSON_AddStringToObject(d, "path", pp);
    free(pp);
    cJSON_AddNumberToObject(d, "size", (double)kids[i]->size);
    cJSON_AddNumberToObject(d, "files", (double)kids[i]->files);
    cJSON_AddItemToArray(dirs, d);
  }
  free(kids);
  cJSON *files = cJSON_AddArrayToObject(o, "files");
  for (int i = 0; i < n->ntop; i++) {
    cJSON *f = cJSON_CreateObject();
    cJSON_AddStringToObject(f, "name", n->top[i].name);
    char *pp = path_join(path, n->top[i].name);
    cJSON_AddStringToObject(f, "path", pp);
    free(pp);
    cJSON_AddNumberToObject(f, "size", (double)n->top[i].size);
    cJSON_AddItemToArray(files, f);
  }
  pthread_mutex_unlock(&lk);
  return o;
}

/* chamado após apagar algo: desconta da análise em memória */
void analyze_forget(const char *path, int64_t size) {
  pthread_mutex_lock(&lk);
  if (A.root && A.path && !strncmp(path, A.path, strlen(A.path))) {
    dnode_t *n = A.root;
    n->size -= size;
    char *rest = xstrdup(path + strlen(A.path));
    char *save = NULL;
    for (char *t = strtok_r(rest, "/", &save); t && n; t = strtok_r(NULL, "/", &save)) {
      dnode_t *f = NULL;
      for (int i = 0; i < n->nk; i++) if (!strcmp(n->kids[i]->name, t)) f = n->kids[i];
      if (f) f->size -= size;
      n = f;
    }
    free(rest);
    for (int i = 0; i < A.ntop; i++) if (!strcmp(A.top[i].name, path)) {
      free(A.top[i].name);
      memmove(&A.top[i], &A.top[i + 1], (A.ntop - i - 1) * sizeof(fitem_t));
      A.ntop--;
      break;
    }
    A.bytes -= size;
  }
  pthread_mutex_unlock(&lk);
}

/* ---------- jogos e apps instalados ---------- */
static int64_t tsize(const char *p) {
  struct stat st;
  if (lstat(p, &st)) return 0;
  if (!S_ISDIR(st.st_mode)) return st.st_size;
  int64_t s = 0;
  DIR *d = opendir(p);
  struct dirent *e;
  while (d && (e = readdir(d))) {
    if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
    char *c = path_join(p, e->d_name);
    s += tsize(c);
    free(c);
  }
  if (d) closedir(d);
  return s;
}

/* título de jogo PS4 (param.sfo) */
static char *sfo_title(const char *path) {
  size_t len;
  unsigned char *b = (unsigned char *)read_file(path, &len);
  if (!b || len < 20 || memcmp(b, "\0PSF", 4)) { free(b); return NULL; }
  uint32_t keyt = b[8] | b[9] << 8 | b[10] << 16 | (uint32_t)b[11] << 24;
  uint32_t datat = b[12] | b[13] << 8 | b[14] << 16 | (uint32_t)b[15] << 24;
  uint32_t n = b[16] | b[17] << 8 | b[18] << 16 | (uint32_t)b[19] << 24;
  char *res = NULL;
  for (uint32_t i = 0; i < n && 20 + i * 16 + 16 <= len; i++) {
    unsigned char *e = b + 20 + i * 16;
    uint16_t ko = e[0] | e[1] << 8;
    uint32_t dlen = e[4] | e[5] << 8 | e[6] << 16 | (uint32_t)e[7] << 24;
    uint32_t doff = e[12] | e[13] << 8 | e[14] << 16 | (uint32_t)e[15] << 24;
    if (keyt + ko < len && !strcmp((char *)b + keyt + ko, "TITLE") && datat + doff + dlen <= len) {
      res = strndup((char *)b + datat + doff, dlen);
      break;
    }
  }
  free(b);
  return res;
}

static char *json_title(const char *path) {
  char *txt = read_file(path, NULL);
  if (!txt) return NULL;
  char *res = NULL;
  /* param.json do PS5 pode ter um cabeçalho binário antes do JSON */
  char *start = strchr(txt, '{');
  cJSON *j = start ? cJSON_Parse(start) : NULL;
  cJSON *lp = cJSON_GetObjectItem(j, "localizedParameters");
  if (lp) {
    cJSON *def = cJSON_GetObjectItem(lp, "defaultLanguage");
    cJSON *pt = cJSON_GetObjectItem(lp, "pt-BR");
    cJSON *l = pt ? pt : cJSON_IsString(def) ? cJSON_GetObjectItem(lp, def->valuestring) : NULL;
    cJSON *t = cJSON_GetObjectItem(l, "titleName");
    if (cJSON_IsString(t)) res = xstrdup(t->valuestring);
  }
  cJSON_Delete(j);
  free(txt);
  return res;
}

static const char *apps_root(void) {
#ifdef __PROSPERO__
  return "/user";
#else
  const char *r = getenv("NIMBO_APPS_ROOT");
  return r ? r : "/nonexistent";
#endif
}

static int cmp_app(const void *a, const void *b) {
  double x = cJSON_GetObjectItem(*(cJSON **)a, "size")->valuedouble, y = cJSON_GetObjectItem(*(cJSON **)b, "size")->valuedouble;
  return x < y ? 1 : x > y ? -1 : 0;
}

cJSON *apps_list(void) {
  const char *root = apps_root();
  char *appdir = path_join(root, "app");
  DIR *d = opendir(appdir);
  int cap = 64, n = 0;
  cJSON **items = malloc(cap * sizeof(cJSON *));
  struct dirent *e;
  while (d && (e = readdir(d))) {
    const char *id = e->d_name;
    if (strlen(id) != 9) continue;
    if (!strcmp(id, "NIMB00001")) continue;
    char *p = path_join(appdir, id);
    if (!is_dir(p)) { free(p); continue; }
    int64_t app = tsize(p);
    char *pp = str_printf("%s/patch/%s", root, id);
    char *pa = str_printf("%s/addcont/%s", root, id);
    int64_t patch = tsize(pp), dlc = tsize(pa);
    char *meta = str_printf("%s/appmeta/%s/param.json", root, id);
    char *sfo = str_printf("%s/appmeta/%s/param.sfo", root, id);
    char *title = json_title(meta);
    if (!title) title = sfo_title(sfo);
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "id", id);
    cJSON_AddStringToObject(o, "title", title ? title : id);
    cJSON_AddStringToObject(o, "platform", !strncmp(id, "PPSA", 4) ? "PS5" : !strncmp(id, "CUSA", 4) ? "PS4" : "App");
    cJSON_AddNumberToObject(o, "app", (double)app);
    cJSON_AddNumberToObject(o, "patch", (double)patch);
    cJSON_AddNumberToObject(o, "dlc", (double)dlc);
    cJSON_AddNumberToObject(o, "size", (double)(app + patch + dlc));
    if (n == cap) { cap *= 2; items = realloc(items, cap * sizeof(cJSON *)); }
    items[n++] = o;
    free(title); free(meta); free(sfo); free(pp); free(pa); free(p);
  }
  if (d) closedir(d);
  free(appdir);
  qsort(items, n, sizeof(cJSON *), cmp_app);
  cJSON *a = cJSON_CreateArray();
  for (int i = 0; i < n; i++) cJSON_AddItemToArray(a, items[i]);
  free(items);
  return a;
}

/* ícone do app: /user/appmeta/<ID>/icon0.png */
char *apps_icon_path(const char *id) {
  for (const char *c = id; *c; c++) if (!((*c >= 'A' && *c <= 'Z') || (*c >= '0' && *c <= '9'))) return NULL;
  if (strlen(id) != 9) return NULL;
  return str_printf("%s/appmeta/%s/icon0.png", apps_root(), id);
}
