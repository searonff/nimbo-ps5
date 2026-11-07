#include "nimbo.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <dirent.h>
#include <time.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/statvfs.h>

static pthread_mutex_t log_lock = PTHREAD_MUTEX_INITIALIZER;

void logf_(const char *fmt, ...) {
  va_list ap;
  pthread_mutex_lock(&log_lock);
  time_t t = time(NULL);
  struct tm tm;
  localtime_r(&t, &tm);
  fprintf(stderr, "[nimbo %02d:%02d:%02d] ", tm.tm_hour, tm.tm_min, tm.tm_sec);
  va_start(ap, fmt);
  vfprintf(stderr, fmt, ap);
  va_end(ap);
  fputc('\n', stderr);
  fflush(stderr);
  pthread_mutex_unlock(&log_lock);
}

char *xstrdup(const char *s) { return s ? strdup(s) : NULL; }

char *str_printf(const char *fmt, ...) {
  va_list ap, ap2;
  va_start(ap, fmt);
  va_copy(ap2, ap);
  int n = vsnprintf(NULL, 0, fmt, ap);
  va_end(ap);
  char *s = malloc(n + 1);
  vsnprintf(s, n + 1, fmt, ap2);
  va_end(ap2);
  return s;
}

bool str_ends_with_ci(const char *s, const char *suf) {
  size_t a = strlen(s), b = strlen(suf);
  return a >= b && strcasecmp(s + a - b, suf) == 0;
}

void sanitize_component(char *s) {
  for (unsigned char *p = (unsigned char *)s; *p; p++) {
    if (*p < 0x20 || strchr("<>:\"\\|?*", *p)) *p = '_';
  }
  /* exFAT não aceita espaço/ponto no fim */
  size_t n = strlen(s);
  while (n > 0 && (s[n - 1] == ' ' || s[n - 1] == '.')) s[--n] = 0;
  if (!*s) strcpy(s, "_");
}

char *sanitize_relpath(const char *rel) {
  char *in = xstrdup(rel ? rel : "");
  for (char *p = in; *p; p++) if (*p == '\\') *p = '/';
  size_t cap = strlen(in) + 8;
  char *out = calloc(1, cap);
  char *save = NULL;
  for (char *tok = strtok_r(in, "/", &save); tok; tok = strtok_r(NULL, "/", &save)) {
    if (!strcmp(tok, ".") || !strcmp(tok, "..") || !*tok) continue;
    char *c = xstrdup(tok);
    sanitize_component(c);
    if (*out) strcat(out, "/");
    strncat(out, c, cap - strlen(out) - 1);
    free(c);
  }
  free(in);
  if (!*out) { free(out); out = xstrdup("download"); }
  return out;
}

char *path_join(const char *a, const char *b) {
  size_t la = strlen(a);
  while (*b == '/') b++;
  if (la && a[la - 1] == '/') return str_printf("%s%s", a, b);
  return str_printf("%s/%s", a, b);
}

char *path_dirname(const char *p) {
  char *d = xstrdup(p);
  char *s = strrchr(d, '/');
  if (!s) { free(d); return xstrdup("."); }
  if (s == d) s[1] = 0; else *s = 0;
  return d;
}

const char *path_basename(const char *p) {
  const char *s = strrchr(p, '/');
  return s ? s + 1 : p;
}

char *path_unique(const char *path) {
  if (!file_exists(path)) return xstrdup(path);
  char *dir = path_dirname(path);
  const char *base = path_basename(path);
  const char *dot = strrchr(base, '.');
  if (!dot || dot == base) dot = base + strlen(base);
  for (int i = 1; i < 10000; i++) {
    char *cand = str_printf("%s/%.*s (%d)%s", dir, (int)(dot - base), base, i, dot);
    if (!file_exists(cand)) { free(dir); return cand; }
    free(cand);
  }
  free(dir);
  return xstrdup(path);
}

int mkdirs(const char *path) {
  char *p = xstrdup(path);
  for (char *s = p + 1; *s; s++) {
    if (*s == '/') {
      *s = 0;
      if (mkdir(p, 0777) && errno != EEXIST) { /* pode já existir */ }
      *s = '/';
    }
  }
  int r = mkdir(p, 0777);
  if (r && errno == EEXIST) r = 0;
  free(p);
  return r;
}

bool file_exists(const char *path) { struct stat st; return stat(path, &st) == 0; }
bool is_dir(const char *path) { struct stat st; return stat(path, &st) == 0 && S_ISDIR(st.st_mode); }
int64_t file_size(const char *path) { struct stat st; return stat(path, &st) ? -1 : (int64_t)st.st_size; }

int64_t disk_free(const char *path) {
  struct statvfs sv;
  if (statvfs(path, &sv)) return -1;
  return (int64_t)sv.f_bavail * (int64_t)sv.f_frsize;
}
int64_t disk_total(const char *path) {
  struct statvfs sv;
  if (statvfs(path, &sv)) return -1;
  return (int64_t)sv.f_blocks * (int64_t)sv.f_frsize;
}

char *read_file(const char *path, size_t *len) {
  FILE *f = fopen(path, "rb");
  if (!f) return NULL;
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  char *b = malloc(n + 1);
  size_t r = fread(b, 1, n, f);
  fclose(f);
  b[r] = 0;
  if (len) *len = r;
  return b;
}

int write_file_atomic(const char *path, const char *data, size_t len) {
  char *tmp = str_printf("%s.tmp", path);
  FILE *f = fopen(tmp, "wb");
  if (!f) { free(tmp); return -1; }
  size_t w = fwrite(data, 1, len, f);
  fflush(f);
  fsync(fileno(f));
  fclose(f);
  int r = (w == len) ? rename(tmp, path) : -1;
  free(tmp);
  return r;
}

int rm_rf(const char *path) {
  struct stat st;
  if (lstat(path, &st)) return -1;
  if (S_ISDIR(st.st_mode)) {
    DIR *d = opendir(path);
    if (d) {
      struct dirent *e;
      while ((e = readdir(d))) {
        if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..")) continue;
        char *c = path_join(path, e->d_name);
        rm_rf(c);
        free(c);
      }
      closedir(d);
    }
    return rmdir(path);
  }
  return unlink(path);
}

double now_sec(void) {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  return tv.tv_sec + tv.tv_usec / 1e6;
}

void msleep(int ms) { usleep((useconds_t)ms * 1000); }

static int hexv(int c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

void url_decode_inplace(char *s) {
  char *o = s;
  for (char *p = s; *p; p++) {
    if (*p == '%' && hexv(p[1]) >= 0 && hexv(p[2]) >= 0) {
      *o++ = (char)(hexv(p[1]) * 16 + hexv(p[2]));
      p += 2;
    } else if (*p == '+') {
      *o++ = ' ';
    } else {
      *o++ = *p;
    }
  }
  *o = 0;
}

char *url_encode(const char *s) {
  static const char *hex = "0123456789ABCDEF";
  char *o = malloc(strlen(s) * 3 + 1), *q = o;
  for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
    if (isalnum(*p) || strchr("-_.~", *p)) *q++ = *p;
    else { *q++ = '%'; *q++ = hex[*p >> 4]; *q++ = hex[*p & 15]; }
  }
  *q = 0;
  return o;
}
