/* Unidades de armazenamento e navegação de pastas. */
#include "nimbo.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dirent.h>
#include <limits.h>
#include <sys/stat.h>

typedef struct { char *label; char *path; char *type; } root_t;

static root_t *roots_get(int *n) {
  static root_t r[16];
  static int count = -1;
  static pthread_mutex_t lk = PTHREAD_MUTEX_INITIALIZER;
  pthread_mutex_lock(&lk);
  for (int i = 0; i < count; i++) { free(r[i].label); free(r[i].path); free(r[i].type); }
  count = 0;
#ifdef __PROSPERO__
  r[count++] = (root_t){ xstrdup("SSD interno"), xstrdup("/data"), xstrdup("internal") };
  for (int i = 0; i < 8 && count < 16; i++) {
    char p[32]; snprintf(p, sizeof p, "/mnt/usb%d", i);
    if (is_dir(p) && disk_total(p) > 0) {
      r[count++] = (root_t){ str_printf("USB %d", i), xstrdup(p), xstrdup("usb") };
    }
  }
  for (int i = 0; i < 2 && count < 16; i++) {
    char p[32]; snprintf(p, sizeof p, "/mnt/ext%d", i);
    if (is_dir(p) && disk_total(p) > 0) {
      r[count++] = (root_t){ str_printf("Armazenamento estendido %d", i), xstrdup(p), xstrdup("ext") };
    }
  }
#else
  /* NIMBO_ROOTS="Rótulo=/caminho;Outro=/caminho2" para testes no PC */
  const char *env = getenv("NIMBO_ROOTS");
  char *s = xstrdup(env ? env : "Pasta temporária=/tmp");
  char *save = NULL;
  for (char *tok = strtok_r(s, ";", &save); tok && count < 16; tok = strtok_r(NULL, ";", &save)) {
    char *eq = strchr(tok, '=');
    if (!eq) continue;
    *eq = 0;
    mkdirs(eq + 1);
    r[count++] = (root_t){ xstrdup(tok), xstrdup(eq + 1), xstrdup(strstr(tok, "USB") ? "usb" : "internal") };
  }
  free(s);
#endif
  *n = count;
  pthread_mutex_unlock(&lk);
  return r;
}

cJSON *storage_list(void) {
  int n;
  root_t *r = roots_get(&n);
  cJSON *a = cJSON_CreateArray();
  for (int i = 0; i < n; i++) {
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "label", r[i].label);
    cJSON_AddStringToObject(o, "path", r[i].path);
    cJSON_AddStringToObject(o, "type", r[i].type);
    cJSON_AddNumberToObject(o, "free", (double)disk_free(r[i].path));
    cJSON_AddNumberToObject(o, "total", (double)disk_total(r[i].path));
    cJSON_AddItemToArray(a, o);
  }
  return a;
}

/* normaliza "/a/b/../c" sem exigir que exista */
static char *normalize(const char *p) {
  if (!p || p[0] != '/') return NULL;
  char *in = xstrdup(p);
  char *out = calloc(1, strlen(p) + 2);
  char *save = NULL;
  for (char *t = strtok_r(in, "/", &save); t; t = strtok_r(NULL, "/", &save)) {
    if (!strcmp(t, ".") || !*t) continue;
    if (!strcmp(t, "..")) {
      char *s = strrchr(out, '/');
      if (s) *s = 0;
      continue;
    }
    strcat(out, "/");
    strcat(out, t);
  }
  free(in);
  if (!*out) strcpy(out, "/");
  return out;
}

bool path_allowed(const char *path) {
  char *np = normalize(path);
  if (!np) return false;
  int n;
  bool ok = false;
  root_t *r = roots_get(&n);
  for (int i = 0; i < n && !ok; i++) {
    size_t l = strlen(r[i].path);
    if (!strncmp(np, r[i].path, l) && (np[l] == 0 || np[l] == '/')) ok = true;
  }
  free(np);
  return ok;
}

char *storage_resolve(const char *path, char **err) {
  char *np = normalize(path);
  if (!np || !path_allowed(np)) {
    free(np);
    *err = xstrdup("Caminho fora das unidades permitidas");
    return NULL;
  }
  return np;
}

static int cmp_entries(const void *a, const void *b) {
  cJSON *x = *(cJSON **)a, *y = *(cJSON **)b;
  int dx = cJSON_IsTrue(cJSON_GetObjectItem(x, "dir")), dy = cJSON_IsTrue(cJSON_GetObjectItem(y, "dir"));
  if (dx != dy) return dy - dx;
  return strcasecmp(cJSON_GetObjectItem(x, "name")->valuestring, cJSON_GetObjectItem(y, "name")->valuestring);
}

cJSON *fs_list(const char *path, char **err) {
  char *np = storage_resolve(path, err);
  if (!np) return NULL;
  DIR *d = opendir(np);
  if (!d) { *err = str_printf("Não foi possível abrir a pasta %s", np); free(np); return NULL; }
  int cap = 64, n = 0;
  cJSON **items = malloc(cap * sizeof(cJSON *));
  struct dirent *e;
  while ((e = readdir(d))) {
    if (e->d_name[0] == '.' ) continue;
    if (str_ends_with_ci(e->d_name, ".nimbopart")) continue;
    char *full = path_join(np, e->d_name);
    struct stat st;
    if (stat(full, &st) == 0) {
      cJSON *o = cJSON_CreateObject();
      cJSON_AddStringToObject(o, "name", e->d_name);
      cJSON_AddStringToObject(o, "path", full);
      cJSON_AddBoolToObject(o, "dir", S_ISDIR(st.st_mode));
      cJSON_AddNumberToObject(o, "size", S_ISDIR(st.st_mode) ? 0 : (double)st.st_size);
      cJSON_AddNumberToObject(o, "mtime", (double)st.st_mtime);
      if (!S_ISDIR(st.st_mode)) {
        arc_kind_t k = archive_kind(e->d_name);
        cJSON_AddStringToObject(o, "archive", k == ARC_FIRST ? "first" : k == ARC_PART ? "part" : "");
      }
      if (n == cap) { cap *= 2; items = realloc(items, cap * sizeof(cJSON *)); }
      items[n++] = o;
    }
    free(full);
  }
  closedir(d);
  qsort(items, n, sizeof(cJSON *), cmp_entries);
  cJSON *res = cJSON_CreateObject();
  cJSON_AddStringToObject(res, "path", np);
  char *parent = path_dirname(np);
  cJSON_AddStringToObject(res, "parent", path_allowed(parent) ? parent : "");
  free(parent);
  cJSON_AddNumberToObject(res, "free", (double)disk_free(np));
  cJSON *arr = cJSON_AddArrayToObject(res, "entries");
  for (int i = 0; i < n; i++) cJSON_AddItemToArray(arr, items[i]);
  free(items);
  free(np);
  return res;
}
