/* Tarefas em segundo plano: extração (libarchive, várias partes, senhas) e copiar/mover. */
#include "nimbo.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <dirent.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <archive.h>
#include <archive_entry.h>

typedef struct task {
  int id;
  char *type;      /* extract | copy | move */
  char *src;       /* primeira parte / origem */
  char *dest;      /* pasta destino */
  char *state;     /* queued running done error canceled */
  char *error;
  char *current;   /* arquivo atual */
  int64_t done, total;
  bool automatic, delete_after;
  volatile bool cancel;
  double created, finished;
} task_t;

static pthread_mutex_t lk = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t cv = PTHREAD_COND_INITIALIZER;
static task_t **tasks;
static int ntasks, captasks, next_id = 1;

/* ---------- reconhecimento de partes ---------- */
/* retorna o número da parte em ".partN.rar" ou -1 */
static int partnum_rar(const char *name, size_t *prefix_len, int *width) {
  size_t n = strlen(name);
  if (n < 10 || strcasecmp(name + n - 4, ".rar")) return -1;
  size_t i = n - 4;
  size_t e = i;
  while (i > 0 && isdigit((unsigned char)name[i - 1])) i--;
  if (i == e || i < 5 || strncasecmp(name + i - 5, ".part", 5)) return -1;
  if (prefix_len) *prefix_len = i - 5;
  if (width) *width = (int)(e - i);
  return atoi(name + i);
}

/* ".r00".. ".r99" / ".s00".. */
static int oldrar_num(const char *name) {
  size_t n = strlen(name);
  if (n < 5 || name[n - 4] != '.') return -1;
  char c = tolower((unsigned char)name[n - 3]);
  if ((c != 'r' && c != 's') || !isdigit((unsigned char)name[n - 2]) || !isdigit((unsigned char)name[n - 1])) return -1;
  return (c == 's' ? 100 : 0) + atoi(name + n - 2);
}

/* ".001", ".002"... */
static int split_num(const char *name) {
  size_t n = strlen(name);
  if (n < 5 || name[n - 4] != '.') return -1;
  for (int k = 1; k <= 3; k++) if (!isdigit((unsigned char)name[n - k])) return -1;
  return atoi(name + n - 3);
}

arc_kind_t archive_kind(const char *filename) {
  const char *name = path_basename(filename);
  int pn = partnum_rar(name, NULL, NULL);
  if (pn >= 0) return pn == 1 ? ARC_FIRST : ARC_PART;
  if (oldrar_num(name) >= 0) return ARC_PART;
  int sn = split_num(name);
  if (sn >= 0) return sn == 1 ? ARC_FIRST : ARC_PART;
  static const char *exts[] = { ".rar", ".zip", ".7z", ".tar", ".tgz", ".tar.gz", ".tar.xz",
                                ".txz", ".iso", ".cab", ".lzh", ".lha", NULL };
  for (int i = 0; exts[i]; i++) if (str_ends_with_ci(name, exts[i])) return ARC_FIRST;
  size_t n = strlen(name);
  if (n > 4 && name[n - 4] == '.' && tolower((unsigned char)name[n - 3]) == 'z' &&
      isdigit((unsigned char)name[n - 2]) && isdigit((unsigned char)name[n - 1])) return ARC_PART; /* .z01 */
  return ARC_NONE;
}

char *archive_first_volume(const char *path) {
  arc_kind_t k = archive_kind(path);
  if (k == ARC_NONE) return NULL;
  if (k == ARC_FIRST) return xstrdup(path);
  char *dir = path_dirname(path);
  const char *name = path_basename(path);
  char *res = NULL;
  size_t pl; int w;
  if (partnum_rar(name, &pl, &w) >= 0) {
    res = str_printf("%s/%.*s.part%0*d.rar", dir, (int)pl, name, w, 1);
  } else if (oldrar_num(name) >= 0) {
    res = str_printf("%s/%.*s.rar", dir, (int)(strlen(name) - 4), name);
  } else if (split_num(name) >= 0) {
    res = str_printf("%s/%.*s.001", dir, (int)(strlen(name) - 4), name);
  } else {  /* .z01 → .zip */
    res = str_printf("%s/%.*s.zip", dir, (int)(strlen(name) - 4), name);
  }
  free(dir);
  return res;
}

typedef struct { int num; char *path; } vol_t;
static int cmp_vol(const void *a, const void *b) { return ((vol_t *)a)->num - ((vol_t *)b)->num; }

char **archive_volumes(const char *first, int *n) {
  char *dir = path_dirname(first);
  const char *name = path_basename(first);
  int cap = 16, c = 0;
  vol_t *v = malloc(cap * sizeof(vol_t));
  size_t pl; int w;
  int mode = 0; /* 0 único, 1 partN.rar, 2 .rar+.rNN, 3 .NNN */
  size_t base_len = 0;
  if (partnum_rar(name, &pl, &w) >= 0) { mode = 1; base_len = pl; }
  else if (split_num(name) == 1) { mode = 3; base_len = strlen(name) - 4; }
  else if (str_ends_with_ci(name, ".rar")) { mode = 2; base_len = strlen(name) - 4; }
  if (mode == 0) {
    v[c++] = (vol_t){ 0, xstrdup(first) };
  } else {
    DIR *d = opendir(dir);
    struct dirent *e;
    while (d && (e = readdir(d))) {
      const char *fn = e->d_name;
      if (strncmp(fn, name, base_len) != 0) continue;
      int num = -1;
      if (mode == 1) { size_t p2; if (partnum_rar(fn, &p2, NULL) >= 0 && p2 == base_len) num = partnum_rar(fn, NULL, NULL); }
      else if (mode == 2) {
        if (strlen(fn) == base_len + 4) {
          if (!strcasecmp(fn + base_len, ".rar")) num = -1000;
          else { int o = oldrar_num(fn); if (o >= 0) num = o; }
        }
      } else if (mode == 3) { if (strlen(fn) == base_len + 4) num = split_num(fn); }
      if (num == -1) continue;
      if (c == cap) { cap *= 2; v = realloc(v, cap * sizeof(vol_t)); }
      v[c++] = (vol_t){ num, path_join(dir, fn) };
    }
    if (d) closedir(d);
    qsort(v, c, sizeof(vol_t), cmp_vol);
  }
  char **out = calloc(c + 1, sizeof(char *));
  for (int i = 0; i < c; i++) out[i] = v[i].path;
  free(v);
  free(dir);
  *n = c;
  return out;
}

/* verifica buracos na numeração; retorna mensagem ou NULL */
static char *volumes_gap(char **vols, int n) {
  if (n < 2) return NULL;
  for (int i = 0; i < n; i++) {
    const char *nm = path_basename(vols[i]);
    int num = partnum_rar(nm, NULL, NULL);
    int expect = i + 1;
    if (num < 0) { num = split_num(nm); }
    if (num < 0) { num = oldrar_num(nm); expect = i - 1; if (i == 0) continue; }
    if (num != expect) return str_printf("Falta uma parte antes de %s", nm);
  }
  return NULL;
}

/* ---------- lista de tarefas ---------- */
static void add_task_locked(task_t *t) {
  if (ntasks == captasks) { captasks = captasks ? captasks * 2 : 32; tasks = realloc(tasks, captasks * sizeof(task_t *)); }
  tasks[ntasks++] = t;
  pthread_cond_signal(&cv);
}

static task_t *new_task(const char *type, const char *src, const char *dest) {
  task_t *t = calloc(1, sizeof *t);
  t->type = xstrdup(type);
  t->src = xstrdup(src);
  t->dest = xstrdup(dest);
  t->state = xstrdup("queued");
  t->error = xstrdup("");
  t->current = xstrdup("");
  t->created = now_sec();
  return t;
}

static void free_task(task_t *t) {
  free(t->type); free(t->src); free(t->dest); free(t->state); free(t->error); free(t->current); free(t);
}

static void tset(task_t *t, const char *state, const char *err) {
  pthread_mutex_lock(&lk);
  free(t->state); t->state = xstrdup(state);
  if (err) { free(t->error); t->error = xstrdup(err); }
  pthread_mutex_unlock(&lk);
}

static void tcur(task_t *t, const char *cur) {
  pthread_mutex_lock(&lk);
  free(t->current); t->current = xstrdup(cur);
  pthread_mutex_unlock(&lk);
}

/* ---------- extração ---------- */
char *archive_strip_ext(const char *name) {
  char *s = xstrdup(name);
  static const char *exts[] = { ".tar.gz", ".tar.xz", ".tgz", ".txz", ".rar", ".zip", ".7z", ".tar",
                                ".iso", ".cab", ".lzh", ".lha", NULL };
  size_t pl;
  if (partnum_rar(s, &pl, NULL) >= 0) { s[pl] = 0; return s; }
  if (split_num(s) >= 0) s[strlen(s) - 4] = 0;
  for (int i = 0; exts[i]; i++) {
    if (str_ends_with_ci(s, exts[i])) { s[strlen(s) - strlen(exts[i])] = 0; break; }
  }
  if (!*s) { free(s); s = xstrdup("extraido"); }
  return s;
}

static const char *friendly_arc_error(struct archive *a, bool encrypted, int npass) {
  const char *m = archive_error_string(a);
  if (!m) m = "erro desconhecido";
  if (strcasestr(m, "passphrase") || strcasestr(m, "password") || strcasestr(m, "decrypt")) {
    return npass ? "Senha incorreta: nenhuma das senhas cadastradas funcionou"
                 : "Arquivo protegido por senha: cadastre a senha em Configurações";
  }
  if (encrypted || strcasestr(m, "encrypt")) {
    return "Este formato com senha (RAR/7z criptografado) ainda não é suportado nesta versão";
  }
  if (strcasestr(m, "truncated") || strcasestr(m, "premature") || strcasestr(m, "volume"))
    return "Arquivo incompleto ou faltando partes";
  return m;
}

static void run_extract(task_t *t) {
  int nv = 0;
  char **vols = archive_volumes(t->src, &nv);
  char *gap = volumes_gap(vols, nv);
  if (gap) { tset(t, "error", gap); free(gap); free_strv(vols, nv); return; }
  int64_t total = 0;
  for (int i = 0; i < nv; i++) { int64_t s = file_size(vols[i]); if (s > 0) total += s; }
  pthread_mutex_lock(&lk); t->total = total; t->done = 0; pthread_mutex_unlock(&lk);

  /* destino */
  char *outdir;
  pthread_mutex_lock(&g_cfg_lock);
  bool sub = g_cfg.extract_to_subfolder;
  pthread_mutex_unlock(&g_cfg_lock);
  if (sub) {
    char *base = archive_strip_ext(path_basename(t->src));
    sanitize_component(base);
    char *cand = path_join(t->dest, base);
    outdir = path_unique(cand);
    free(cand); free(base);
  } else {
    outdir = xstrdup(t->dest);
  }
  if (mkdirs(outdir)) {
    char *e = str_printf("Não foi possível criar %s", outdir);
    tset(t, "error", e); free(e); free(outdir); free_strv(vols, nv); return;
  }

  int npass = 0;
  char **pass = config_passwords(&npass);
  struct archive *a = archive_read_new();
  archive_read_support_format_all(a);
  archive_read_support_filter_all(a);
  for (int i = 0; i < npass; i++) archive_read_add_passphrase(a, pass[i]);
  int r = (nv == 1) ? archive_read_open_filename(a, vols[0], 1 << 20)
                    : archive_read_open_filenames(a, (const char **)vols, 1 << 20);
  char *err = NULL;
  bool encrypted = false;
  int files = 0;
  int64_t freeb = disk_free(outdir);
  if (r != ARCHIVE_OK) {
    err = xstrdup(friendly_arc_error(a, false, npass));
  } else {
    struct archive_entry *e;
    char *buf = malloc(1 << 20);
    int64_t written = 0;
    while (!t->cancel && !err) {
      r = archive_read_next_header(a, &e);
      if (r == ARCHIVE_EOF) break;
      if (r < ARCHIVE_WARN) { err = xstrdup(friendly_arc_error(a, encrypted, npass)); break; }
      if (archive_entry_is_encrypted(e)) encrypted = true;
      const char *pn = archive_entry_pathname_utf8(e);
      if (!pn) pn = archive_entry_pathname(e);
      if (!pn || !*pn) continue;
      char *rel = sanitize_relpath(pn);
      char *full = path_join(outdir, rel);
      mode_t ft = archive_entry_filetype(e);
      if (ft == AE_IFDIR) {
        mkdirs(full);
      } else if (ft == AE_IFREG || ft == 0) {
        char *pd = path_dirname(full);
        mkdirs(pd);
        free(pd);
        tcur(t, rel);
        int64_t esz = archive_entry_size_is_set(e) ? archive_entry_size(e) : 0;
        if (freeb >= 0 && esz > 0 && written + esz > freeb) { err = xstrdup("Espaço insuficiente para extrair"); free(rel); free(full); break; }
        int fd = open(full, O_WRONLY | O_CREAT | O_TRUNC, 0666);
        if (fd < 0) {
          err = str_printf("Não foi possível criar %s: %s", rel, strerror(errno));
        } else {
          for (;;) {
            if (t->cancel) break;
            la_ssize_t got = archive_read_data(a, buf, 1 << 20);
            if (got == 0) break;
            if (got < 0) { err = xstrdup(friendly_arc_error(a, encrypted, npass)); break; }
            if (write(fd, buf, got) != got) { err = str_printf("Erro ao gravar: %s", strerror(errno)); break; }
            written += got;
            pthread_mutex_lock(&lk);
            t->done = archive_filter_bytes(a, -1);
            pthread_mutex_unlock(&lk);
          }
          close(fd);
          if (err || t->cancel) unlink(full);
          else {
            files++;
            time_t mt = archive_entry_mtime(e);
            if (mt > 0) { struct timeval tv[2] = { { mt, 0 }, { mt, 0 } }; utimes(full, tv); }
          }
        }
      } /* links e dispositivos são ignorados */
      free(rel);
      free(full);
    }
    free(buf);
  }
  archive_read_close(a);
  archive_read_free(a);
  free_strv(pass, npass);

  if ((t->cancel || err) && sub) rm_rf(outdir);   /* não deixa pasta pela metade */
  if (t->cancel) {
    tset(t, "canceled", "");
  } else if (err) {
    tset(t, "error", err);
    platform_notify("Falha ao extrair %s: %s", path_basename(t->src), err);
  } else {
    if (t->delete_after) for (int i = 0; i < nv; i++) unlink(vols[i]);
    pthread_mutex_lock(&lk);
    t->done = t->total;
    free(t->current); t->current = str_printf("%d arquivo(s) em %s", files, outdir);
    free(t->dest); t->dest = xstrdup(outdir);
    pthread_mutex_unlock(&lk);
    tset(t, "done", "");
    platform_notify("Extraído: %s", path_basename(t->src));
  }
  free(err);
  free(outdir);
  free_strv(vols, nv);
}

/* ---------- copiar / mover ---------- */
static int64_t tree_size(const char *p) {
  struct stat st;
  if (lstat(p, &st)) return 0;
  if (!S_ISDIR(st.st_mode)) return st.st_size;
  int64_t s = 0;
  DIR *d = opendir(p);
  struct dirent *e;
  while (d && (e = readdir(d))) {
    if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
    char *c = path_join(p, e->d_name);
    s += tree_size(c);
    free(c);
  }
  if (d) closedir(d);
  return s;
}

static char *copy_tree(task_t *t, const char *src, const char *dst, char *buf) {
  struct stat st;
  if (lstat(src, &st)) return str_printf("Origem não encontrada: %s", src);
  if (S_ISDIR(st.st_mode)) {
    if (mkdirs(dst)) return str_printf("Não foi possível criar %s", dst);
    DIR *d = opendir(src);
    struct dirent *e;
    char *err = NULL;
    while (d && !err && !t->cancel && (e = readdir(d))) {
      if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
      char *s2 = path_join(src, e->d_name);
      char *n2 = xstrdup(e->d_name);
      sanitize_component(n2);
      char *d2 = path_join(dst, n2);
      err = copy_tree(t, s2, d2, buf);
      free(s2); free(d2); free(n2);
    }
    if (d) closedir(d);
    return err;
  }
  if (!S_ISREG(st.st_mode)) return NULL;
  tcur(t, path_basename(src));
  int in = open(src, O_RDONLY);
  if (in < 0) return str_printf("Não foi possível ler %s", src);
  int out = open(dst, O_WRONLY | O_CREAT | O_TRUNC, 0666);
  if (out < 0) { close(in); return str_printf("Não foi possível criar %s: %s", dst, strerror(errno)); }
  char *err = NULL;
  for (;;) {
    if (t->cancel) break;
    ssize_t r = read(in, buf, 1 << 20);
    if (r == 0) break;
    if (r < 0) { err = str_printf("Erro de leitura: %s", strerror(errno)); break; }
    if (write(out, buf, r) != r) { err = str_printf("Erro ao gravar: %s", strerror(errno)); break; }
    pthread_mutex_lock(&lk); t->done += r; pthread_mutex_unlock(&lk);
  }
  close(in);
  close(out);
  if (err || t->cancel) unlink(dst);
  else { struct timeval tv[2] = { { st.st_mtime, 0 }, { st.st_mtime, 0 } }; utimes(dst, tv); }
  return err;
}

static void run_copy(task_t *t, bool move) {
  char *nm = xstrdup(path_basename(t->src));
  sanitize_component(nm);
  char *cand = path_join(t->dest, nm);
  char *dst = path_unique(cand);
  free(cand); free(nm);
  if (move && rename(t->src, dst) == 0) {
    tcur(t, path_basename(dst));
    tset(t, "done", "");
    free(dst);
    return;
  }
  int64_t total = tree_size(t->src);
  int64_t freeb = disk_free(t->dest);
  if (freeb >= 0 && total > freeb) { tset(t, "error", "Espaço insuficiente no destino"); free(dst); return; }
  pthread_mutex_lock(&lk); t->total = total; t->done = 0; pthread_mutex_unlock(&lk);
  char *buf = malloc(1 << 20);
  char *err = copy_tree(t, t->src, dst, buf);
  free(buf);
  if (t->cancel) { rm_rf(dst); tset(t, "canceled", ""); }
  else if (err) { rm_rf(dst); tset(t, "error", err); }
  else {
    if (move) rm_rf(t->src);
    tset(t, "done", "");
    platform_notify("%s concluído: %s", move ? "Mover" : "Copiar", path_basename(t->src));
  }
  free(err);
  free(dst);
}

/* ---------- worker ---------- */
static void *worker(void *arg) {
  (void)arg;
  for (;;) {
    pthread_mutex_lock(&lk);
    task_t *t = NULL;
    while (!t && !g_stop) {
      for (int i = 0; i < ntasks; i++) if (!strcmp(tasks[i]->state, "queued")) { t = tasks[i]; break; }
      if (!t) {
        struct timespec ts;
        struct timeval tv; gettimeofday(&tv, NULL);
        ts.tv_sec = tv.tv_sec + 1; ts.tv_nsec = tv.tv_usec * 1000;
        pthread_cond_timedwait(&cv, &lk, &ts);
      }
    }
    if (!t) { pthread_mutex_unlock(&lk); return NULL; }
    free(t->state); t->state = xstrdup("running");
    pthread_mutex_unlock(&lk);
    if (!strcmp(t->type, "extract")) run_extract(t);
    else run_copy(t, !strcmp(t->type, "move"));
    pthread_mutex_lock(&lk);
    t->finished = now_sec();
    pthread_mutex_unlock(&lk);
  }
}

void tasks_init(void) {
  pthread_t th;
  pthread_create(&th, NULL, worker, NULL);
  pthread_detach(th);
}

static bool extract_already_queued(const char *first) {
  for (int i = 0; i < ntasks; i++) {
    task_t *t = tasks[i];
    if (!strcmp(t->type, "extract") && !strcmp(t->src, first) &&
        (!strcmp(t->state, "queued") || !strcmp(t->state, "running") || !strcmp(t->state, "done"))) return true;
  }
  return false;
}

int tasks_extract(const char *first, bool automatic, bool delete_after, char **err) {
  if (!path_allowed(first) || !file_exists(first)) { *err = xstrdup("Arquivo não encontrado"); return -1; }
  if (archive_kind(first) != ARC_FIRST) { *err = xstrdup("Escolha a primeira parte do arquivo compactado"); return -1; }
  char *dir = path_dirname(first);
  task_t *t = new_task("extract", first, dir);
  free(dir);
  t->automatic = automatic;
  t->delete_after = delete_after;
  pthread_mutex_lock(&lk);
  if (automatic && extract_already_queued(first)) { pthread_mutex_unlock(&lk); free_task(t); return 0; }
  t->id = next_id++;
  add_task_locked(t);
  int id = t->id;
  pthread_mutex_unlock(&lk);
  return id;
}

int tasks_copy(const char *src, const char *dst_dir, bool move, char **err) {
  if (!path_allowed(src) || !file_exists(src)) { *err = xstrdup("Origem não encontrada"); return -1; }
  if (!path_allowed(dst_dir) || !is_dir(dst_dir)) { *err = xstrdup("Pasta de destino inválida"); return -1; }
  size_t l = strlen(src);
  if (!strncmp(dst_dir, src, l) && (dst_dir[l] == 0 || dst_dir[l] == '/')) {
    *err = xstrdup("Não dá para copiar uma pasta para dentro dela mesma");
    return -1;
  }
  char *pd = path_dirname(src);
  bool same = !strcmp(pd, dst_dir);
  free(pd);
  if (move && same) { *err = xstrdup("O item já está nessa pasta"); return -1; }
  task_t *t = new_task(move ? "move" : "copy", src, dst_dir);
  pthread_mutex_lock(&lk);
  t->id = next_id++;
  add_task_locked(t);
  int id = t->id;
  pthread_mutex_unlock(&lk);
  return id;
}

cJSON *tasks_json(void) {
  cJSON *a = cJSON_CreateArray();
  pthread_mutex_lock(&lk);
  for (int i = 0; i < ntasks; i++) {
    task_t *t = tasks[i];
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "id", t->id);
    cJSON_AddStringToObject(o, "type", t->type);
    cJSON_AddStringToObject(o, "src", t->src);
    cJSON_AddStringToObject(o, "name", path_basename(t->src));
    cJSON_AddStringToObject(o, "dest", t->dest);
    cJSON_AddStringToObject(o, "state", t->state);
    cJSON_AddStringToObject(o, "error", t->error);
    cJSON_AddStringToObject(o, "current", t->current);
    cJSON_AddNumberToObject(o, "done", (double)t->done);
    cJSON_AddNumberToObject(o, "total", (double)t->total);
    cJSON_AddBoolToObject(o, "automatic", t->automatic);
    cJSON_AddItemToArray(a, o);
  }
  pthread_mutex_unlock(&lk);
  return a;
}

int tasks_action(int id, const char *action, char **err) {
  pthread_mutex_lock(&lk);
  task_t *t = NULL;
  int idx = -1;
  for (int i = 0; i < ntasks; i++) if (tasks[i]->id == id) { t = tasks[i]; idx = i; }
  int r = 0;
  if (!t) { *err = xstrdup("Tarefa não encontrada"); r = -1; }
  else if (!strcmp(action, "cancel")) {
    if (!strcmp(t->state, "running")) t->cancel = true;
    else if (!strcmp(t->state, "queued")) { free(t->state); t->state = xstrdup("canceled"); }
  } else if (!strcmp(action, "retry")) {
    if (!strcmp(t->state, "error") || !strcmp(t->state, "canceled")) {
      free(t->state); t->state = xstrdup("queued");
      free(t->error); t->error = xstrdup("");
      t->cancel = false;
      pthread_cond_signal(&cv);
    }
  } else if (!strcmp(action, "remove")) {
    if (!strcmp(t->state, "running")) { *err = xstrdup("Cancele antes de remover"); r = -1; }
    else {
      memmove(&tasks[idx], &tasks[idx + 1], (ntasks - idx - 1) * sizeof(task_t *));
      ntasks--;
      free_task(t);
    }
  } else { *err = xstrdup("Ação inválida"); r = -1; }
  pthread_mutex_unlock(&lk);
  return r;
}

void tasks_clear_finished(void) {
  pthread_mutex_lock(&lk);
  for (int i = ntasks - 1; i >= 0; i--) {
    task_t *t = tasks[i];
    if (!strcmp(t->state, "done") || !strcmp(t->state, "canceled")) {
      memmove(&tasks[i], &tasks[i + 1], (ntasks - i - 1) * sizeof(task_t *));
      ntasks--;
      free_task(t);
    }
  }
  pthread_mutex_unlock(&lk);
}

int tasks_active_count(void) {
  int n = 0;
  pthread_mutex_lock(&lk);
  for (int i = 0; i < ntasks; i++)
    if (!strcmp(tasks[i]->state, "running") || !strcmp(tasks[i]->state, "queued")) n++;
  pthread_mutex_unlock(&lk);
  return n;
}

/* chamado quando um download termina: extrai se todas as partes estiverem prontas */
void tasks_on_download_done(const char *final_path, bool extract, bool delete_after) {
  if (!extract) return;
  char *first = archive_first_volume(final_path);
  if (!first) return;
  /* alguma parte do mesmo conjunto ainda pendente na fila? */
  int np = 0;
  char **pend = dl_pending_paths(&np);
  bool waiting = false;
  for (int i = 0; i < np && !waiting; i++) {
    char *f = archive_first_volume(pend[i]);
    if (f && !strcmp(f, first)) waiting = true;
    free(f);
  }
  free_strv(pend, np);
  if (waiting) { LOG("aguardando outras partes de %s", first); free(first); return; }
  if (!file_exists(first)) { LOG("primeira parte ausente: %s", first); free(first); return; }
  char *err = NULL;
  if (tasks_extract(first, true, delete_after, &err) < 0) { LOG("auto-extrair: %s", err); free(err); }
  free(first);
}
