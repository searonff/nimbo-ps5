/* Motor de downloads: fila, várias conexões por arquivo (segmentos com Range),
 * retomada, limite de velocidade global, persistência em jobs.json. */
#include "nimbo.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include <curl/curl.h>

#define MIN_SEG_FILE (16LL * 1024 * 1024)   /* abaixo disso usa 1 conexão */
#define SPACE_MARGIN (64LL * 1024 * 1024)

typedef struct { int64_t start, end, done; } seg_t;   /* end inclusivo; -1 = desconhecido */

typedef struct job {
  int id;
  char *type;          /* "torbox" | "direct" */
  char *tb_kind;       /* torrents/usenet/webdl */
  int64_t item_id, file_id;
  char *url;           /* direto: link original */
  char *name;          /* nome relativo (pode ter subpastas) */
  char *dest_dir;
  char *final_path;
  int64_t size;
  char *state;         /* queued downloading paused done error */
  char *error;
  double created, finished;
  seg_t *segs;
  int nseg;
  bool ranges;
  bool x_extract, x_delete;   /* extrair ao terminar / apagar compactado */
  /* execução */
  volatile int abort;  /* 0, 1=pausar, 2=cancelar */
  bool running;
  int64_t speed;
  int64_t last_bytes;
  int active_conns;
} job_t;

static pthread_mutex_t lk = PTHREAD_MUTEX_INITIALIZER;
static job_t **jobs;
static int njobs, capjobs, next_id = 1;
static volatile bool dirty;
static pthread_t disp_thread;

/* ---------- limite de velocidade global (token bucket) ---------- */
static pthread_mutex_t tb_lk = PTHREAD_MUTEX_INITIALIZER;
static double tb_tokens, tb_last;

void throttle_consume(size_t n) {
  int64_t limit = config_speed_limit_bps();
  if (limit <= 0) return;
  pthread_mutex_lock(&tb_lk);
  double t = now_sec();
  if (tb_last == 0) tb_last = t;
  tb_tokens += (t - tb_last) * limit;
  if (tb_tokens > limit) tb_tokens = limit;      /* rajada máx. de 1 s */
  tb_last = t;
  tb_tokens -= (double)n;
  double debt = -tb_tokens;
  pthread_mutex_unlock(&tb_lk);
  if (debt > 0) {
    double wait = debt / limit;
    if (wait > 2) wait = 2;
    usleep((useconds_t)(wait * 1e6));
  }
}

/* ---------- helpers ---------- */
static int64_t job_done_bytes(job_t *j) {
  int64_t s = 0;
  for (int i = 0; i < j->nseg; i++) s += j->segs[i].done;
  return s;
}

static int64_t job_remaining(job_t *j) {
  if (j->size < 0) return -1;
  return j->size - job_done_bytes(j);
}

static char *part_path(job_t *j) { return str_printf("%s.nimbopart", j->final_path); }

static void set_state(job_t *j, const char *st, const char *err) {
  free(j->state); j->state = xstrdup(st);
  free(j->error); j->error = xstrdup(err ? err : "");
  dirty = true;
}

static job_t *find_job(int id) {
  for (int i = 0; i < njobs; i++) if (jobs[i]->id == id) return jobs[i];
  return NULL;
}

static void free_job(job_t *j) {
  free(j->type); free(j->tb_kind); free(j->url); free(j->name); free(j->dest_dir);
  free(j->final_path); free(j->state); free(j->error); free(j->segs); free(j);
}

static void remove_job_locked(job_t *j) {
  for (int i = 0; i < njobs; i++) {
    if (jobs[i] == j) {
      memmove(&jobs[i], &jobs[i + 1], (njobs - i - 1) * sizeof(job_t *));
      njobs--;
      break;
    }
  }
  free_job(j);
  dirty = true;
}

static void add_job_locked(job_t *j) {
  if (njobs == capjobs) { capjobs = capjobs ? capjobs * 2 : 32; jobs = realloc(jobs, capjobs * sizeof(job_t *)); }
  jobs[njobs++] = j;
  dirty = true;
}

/* ---------- persistência ---------- */
static cJSON *job_to_json(job_t *j, bool full) {
  cJSON *o = cJSON_CreateObject();
  cJSON_AddNumberToObject(o, "id", j->id);
  cJSON_AddStringToObject(o, "type", j->type);
  cJSON_AddStringToObject(o, "tb_kind", j->tb_kind ? j->tb_kind : "");
  cJSON_AddNumberToObject(o, "item_id", (double)j->item_id);
  cJSON_AddNumberToObject(o, "file_id", (double)j->file_id);
  cJSON_AddStringToObject(o, "url", j->url ? j->url : "");
  cJSON_AddStringToObject(o, "name", j->name ? j->name : "");
  cJSON_AddStringToObject(o, "dest_dir", j->dest_dir);
  cJSON_AddStringToObject(o, "final_path", j->final_path ? j->final_path : "");
  cJSON_AddNumberToObject(o, "size", (double)j->size);
  cJSON_AddStringToObject(o, "state", j->state);
  cJSON_AddStringToObject(o, "error", j->error ? j->error : "");
  cJSON_AddNumberToObject(o, "created", j->created);
  cJSON_AddNumberToObject(o, "finished", j->finished);
  int64_t done = job_done_bytes(j);
  cJSON_AddNumberToObject(o, "done", (double)done);
  cJSON_AddBoolToObject(o, "x_extract", j->x_extract);
  cJSON_AddBoolToObject(o, "x_delete", j->x_delete);
  if (full) {
    cJSON_AddBoolToObject(o, "ranges", j->ranges);
    cJSON *a = cJSON_AddArrayToObject(o, "segs");
    for (int i = 0; i < j->nseg; i++) {
      cJSON *s = cJSON_CreateArray();
      cJSON_AddItemToArray(s, cJSON_CreateNumber((double)j->segs[i].start));
      cJSON_AddItemToArray(s, cJSON_CreateNumber((double)j->segs[i].end));
      cJSON_AddItemToArray(s, cJSON_CreateNumber((double)j->segs[i].done));
      cJSON_AddItemToArray(a, s);
    }
  } else {
    const char *disp = j->name ? path_basename(j->name) : (j->url ? j->url : "?");
    cJSON_AddStringToObject(o, "display", disp);
    cJSON_AddNumberToObject(o, "speed", (double)j->speed);
    cJSON_AddNumberToObject(o, "conns", j->active_conns);
    int64_t rem = job_remaining(j);
    cJSON_AddNumberToObject(o, "eta", (j->speed > 0 && rem > 0) ? (double)(rem / j->speed) : -1);
  }
  return o;
}

static void save_locked(void) {
  cJSON *a = cJSON_CreateArray();
  for (int i = 0; i < njobs; i++) cJSON_AddItemToArray(a, job_to_json(jobs[i], true));
  char *txt = cJSON_PrintUnformatted(a);
  cJSON_Delete(a);
  char *p = path_join(g_data_dir, "jobs.json");
  mkdirs(g_data_dir);
  write_file_atomic(p, txt, strlen(txt));
  free(p);
  free(txt);
  dirty = false;
}

static const char *js(cJSON *o, const char *k) {
  cJSON *v = cJSON_GetObjectItem(o, k);
  return cJSON_IsString(v) ? v->valuestring : "";
}
static double jnumv(cJSON *o, const char *k) {
  cJSON *v = cJSON_GetObjectItem(o, k);
  return cJSON_IsNumber(v) ? v->valuedouble : 0;
}

static void load_jobs(void) {
  char *p = path_join(g_data_dir, "jobs.json");
  char *txt = read_file(p, NULL);
  free(p);
  if (!txt) return;
  cJSON *a = cJSON_Parse(txt);
  free(txt);
  cJSON *o;
  cJSON_ArrayForEach(o, a) {
    job_t *j = calloc(1, sizeof *j);
    j->id = (int)jnumv(o, "id");
    if (j->id >= next_id) next_id = j->id + 1;
    j->type = xstrdup(js(o, "type"));
    j->tb_kind = *js(o, "tb_kind") ? xstrdup(js(o, "tb_kind")) : NULL;
    j->item_id = (int64_t)jnumv(o, "item_id");
    j->file_id = (int64_t)jnumv(o, "file_id");
    j->url = *js(o, "url") ? xstrdup(js(o, "url")) : NULL;
    j->name = *js(o, "name") ? xstrdup(js(o, "name")) : NULL;
    j->dest_dir = xstrdup(js(o, "dest_dir"));
    j->final_path = *js(o, "final_path") ? xstrdup(js(o, "final_path")) : NULL;
    j->size = (int64_t)jnumv(o, "size");
    const char *st = js(o, "state");
    j->state = xstrdup(!strcmp(st, "downloading") ? "queued" : st);
    j->error = xstrdup(js(o, "error"));
    j->created = jnumv(o, "created");
    j->finished = jnumv(o, "finished");
    j->ranges = cJSON_IsTrue(cJSON_GetObjectItem(o, "ranges"));
    j->x_extract = cJSON_IsTrue(cJSON_GetObjectItem(o, "x_extract"));
    j->x_delete = cJSON_IsTrue(cJSON_GetObjectItem(o, "x_delete"));
    cJSON *segs = cJSON_GetObjectItem(o, "segs");
    j->nseg = cJSON_GetArraySize(segs);
    if (j->nseg) {
      j->segs = calloc(j->nseg, sizeof(seg_t));
      for (int i = 0; i < j->nseg; i++) {
        cJSON *s = cJSON_GetArrayItem(segs, i);
        j->segs[i].start = (int64_t)cJSON_GetArrayItem(s, 0)->valuedouble;
        j->segs[i].end = (int64_t)cJSON_GetArrayItem(s, 1)->valuedouble;
        j->segs[i].done = (int64_t)cJSON_GetArrayItem(s, 2)->valuedouble;
      }
    }
    /* se o .nimbopart sumiu, recomeça do zero */
    if (strcmp(j->state, "done") && j->final_path) {
      char *pp = part_path(j);
      if (!file_exists(pp)) { free(j->segs); j->segs = NULL; j->nseg = 0; }
      free(pp);
    }
    add_job_locked(j);
  }
  cJSON_Delete(a);
  LOG("%d downloads restaurados", njobs);
}

/* ---------- sondagem (tamanho, Range, nome) ---------- */
typedef struct {
  long status;
  int64_t total;
  int64_t clen;
  bool ranges;
  char *filename;
} probe_t;

static size_t probe_hdr(char *b, size_t s, size_t n, void *ud) {
  probe_t *p = ud;
  size_t len = s * n;
  char *line = strndup(b, len);
  char *e = line + strlen(line);
  while (e > line && (e[-1] == '\r' || e[-1] == '\n')) *--e = 0;
  if (!strncasecmp(line, "HTTP/", 5)) {        /* nova resposta (redirecionamento) */
    p->total = -1; p->clen = -1; p->ranges = false;
  } else if (!strncasecmp(line, "content-range:", 14)) {
    char *sl = strrchr(line, '/');
    if (sl && sl[1] != '*') p->total = strtoll(sl + 1, NULL, 10);
    p->ranges = true;
  } else if (!strncasecmp(line, "content-length:", 15)) {
    p->clen = strtoll(line + 15, NULL, 10);
  } else if (!strncasecmp(line, "content-disposition:", 20)) {
    char *f = strcasestr(line, "filename*=");
    if (f) {
      f += 10;
      char *q = strstr(f, "''");
      if (q) f = q + 2;
      char *end = strchr(f, ';');
      if (end) *end = 0;
      free(p->filename); p->filename = xstrdup(f);
      url_decode_inplace(p->filename);
    } else if ((f = strcasestr(line, "filename="))) {
      f += 9;
      if (*f == '"') { f++; char *q = strchr(f, '"'); if (q) *q = 0; }
      else { char *end = strchr(f, ';'); if (end) *end = 0; }
      free(p->filename); p->filename = xstrdup(f);
    }
  }
  free(line);
  return len;
}

static size_t probe_body(char *b, size_t s, size_t n, void *ud) { (void)b; (void)ud; return s * n; }

static int probe(const char *url, probe_t *p, char **eff_url, char **err) {
  memset(p, 0, sizeof *p);
  p->total = p->clen = -1;
  CURL *c = curl_easy_init();
  http_setup_common(c);
  curl_easy_setopt(c, CURLOPT_URL, url);
  curl_easy_setopt(c, CURLOPT_RANGE, "0-0");
  curl_easy_setopt(c, CURLOPT_HEADERFUNCTION, probe_hdr);
  curl_easy_setopt(c, CURLOPT_HEADERDATA, p);
  curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, probe_body);
  curl_easy_setopt(c, CURLOPT_ACCEPT_ENCODING, NULL);   /* tamanho real */
  curl_easy_setopt(c, CURLOPT_TIMEOUT, 60L);
  CURLcode rc = curl_easy_perform(c);
  curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &p->status);
  char *eu = NULL;
  curl_easy_getinfo(c, CURLINFO_EFFECTIVE_URL, &eu);
  *eff_url = xstrdup(eu ? eu : url);
  curl_easy_cleanup(c);
  if (rc != CURLE_OK) { *err = str_printf("Falha de conexão: %s", curl_easy_strerror(rc)); return -1; }
  if (p->status >= 400) { *err = str_printf("Servidor respondeu HTTP %ld", p->status); return -1; }
  if (p->status != 206) { p->ranges = false; p->total = p->clen; }
  return 0;
}

/* ---------- download de um segmento ---------- */
typedef struct {
  job_t *job;
  seg_t *seg;
  int fd;
  const char *url;
  char *err;
  int relink;        /* 1 = link expirou */
  bool fatal;
} segctx_t;

static size_t seg_write(char *b, size_t s, size_t n, void *ud) {
  segctx_t *x = ud;
  size_t len = s * n;
  if (x->job->abort) return 0;
  seg_t *sg = x->seg;
  int64_t off = sg->start + sg->done;
  if (sg->end >= 0) {
    int64_t room = sg->end - off + 1;
    if (room <= 0) return 0;              /* segmento completo: encerra */
    if ((int64_t)len > room) len = (size_t)room;
  }
  size_t w = 0;
  while (w < len) {
    ssize_t r = pwrite(x->fd, b + w, len - w, off + w);
    if (r < 0) {
      if (errno == EINTR) continue;
      free(x->err);
      x->err = str_printf("Erro ao gravar no disco: %s", strerror(errno));
      x->fatal = true;
      return 0;
    }
    w += r;
  }
  pthread_mutex_lock(&lk);
  sg->done += len;
  pthread_mutex_unlock(&lk);
  throttle_consume(len);
  return s * n == len ? len : 0;          /* 0 => para quando completa o fim */
}

static int seg_progress(void *ud, curl_off_t a, curl_off_t b, curl_off_t c, curl_off_t d) {
  (void)a; (void)b; (void)c; (void)d;
  segctx_t *x = ud;
  return x->job->abort ? 1 : 0;
}

static bool seg_complete(seg_t *s) { return s->end >= 0 && s->start + s->done > s->end; }

static void *seg_thread(void *arg) {
  segctx_t *x = arg;
  seg_t *sg = x->seg;
  int fails = 0;
  pthread_mutex_lock(&lk); x->job->active_conns++; pthread_mutex_unlock(&lk);
  while (!x->job->abort && !seg_complete(sg) && !x->fatal) {
    CURL *c = curl_easy_init();
    http_setup_common(c);
    curl_easy_setopt(c, CURLOPT_URL, x->url);
    curl_easy_setopt(c, CURLOPT_ACCEPT_ENCODING, NULL);
    char range[64];
    int64_t from = sg->start + sg->done;
    if (x->job->ranges) {
      if (sg->end >= 0) snprintf(range, sizeof range, "%lld-%lld", (long long)from, (long long)sg->end);
      else snprintf(range, sizeof range, "%lld-", (long long)from);
      curl_easy_setopt(c, CURLOPT_RANGE, range);
    }
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, seg_write);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, x);
    curl_easy_setopt(c, CURLOPT_NOPROGRESS, 0L);
    curl_easy_setopt(c, CURLOPT_XFERINFOFUNCTION, seg_progress);
    curl_easy_setopt(c, CURLOPT_XFERINFODATA, x);
    curl_easy_setopt(c, CURLOPT_LOW_SPEED_LIMIT, 1L);
    curl_easy_setopt(c, CURLOPT_LOW_SPEED_TIME, 60L);
    curl_easy_setopt(c, CURLOPT_FAILONERROR, 1L);
    curl_easy_setopt(c, CURLOPT_BUFFERSIZE, 256L * 1024);
    int64_t before = sg->done;
    CURLcode rc = curl_easy_perform(c);
    long status = 0;
    curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &status);
    curl_easy_cleanup(c);
    if (x->job->abort || x->fatal) break;
    if (x->job->ranges && status == 200 && from > 0) {
      free(x->err); x->err = xstrdup("O servidor parou de aceitar retomada (Range)");
      x->fatal = true;
      break;
    }
    if (rc == CURLE_OK || seg_complete(sg)) {
      if (sg->end < 0) { sg->end = sg->start + sg->done - 1; }   /* tamanho desconhecido: terminou */
      break;
    }
    if (status == 403 || status == 404 || status == 410 || status == 401) { x->relink = 1; break; }
    if (sg->done > before) fails = 0; else fails++;
    if (fails >= 8) {
      free(x->err);
      x->err = status >= 400 ? str_printf("Servidor respondeu HTTP %ld", status)
                             : str_printf("Falha de conexão: %s", curl_easy_strerror(rc));
      break;
    }
    LOG("job %d: conexão caiu (%s), tentando de novo", x->job->id, curl_easy_strerror(rc));
    for (int i = 0; i < 10 * (fails < 5 ? fails + 1 : 5) && !x->job->abort; i++) msleep(200);
  }
  pthread_mutex_lock(&lk); x->job->active_conns--; pthread_mutex_unlock(&lk);
  return NULL;
}

/* ---------- execução de um download ---------- */
static char *resolve_url(job_t *j, char **err) {
  if (!strcmp(j->type, "torbox")) return torbox_requestdl(j->tb_kind, j->item_id, j->file_id, err);
  return xstrdup(j->url);
}

static void maybe_delete_from_cloud(job_t *j) {
  if (strcmp(j->type, "torbox")) return;
  pthread_mutex_lock(&g_cfg_lock);
  bool on = g_cfg.delete_from_cloud;
  pthread_mutex_unlock(&g_cfg_lock);
  if (!on) return;
  pthread_mutex_lock(&lk);
  bool others = false;
  for (int i = 0; i < njobs; i++) {
    job_t *o = jobs[i];
    if (o != j && !strcmp(o->type, "torbox") && o->item_id == j->item_id &&
        !strcmp(o->tb_kind, j->tb_kind) && strcmp(o->state, "done")) others = true;
  }
  char *kind = xstrdup(j->tb_kind);
  int64_t id = j->item_id;
  pthread_mutex_unlock(&lk);
  if (others) { free(kind); return; }
  char *err = NULL;
  if (torbox_delete(kind, id, &err) == 0) LOG("item %lld removido do TorBox", (long long)id);
  else { LOG("falha ao remover do TorBox: %s", err); free(err); }
  free(kind);
}

static void *job_thread(void *arg) {
  job_t *j = arg;
  char *err = NULL, *url = NULL;
  int fd = -1;
  int relinks = 0;

  url = resolve_url(j, &err);
  if (!url) goto fail;

  if (!j->segs) {
    probe_t p;
    char *eff = NULL;
    if (probe(url, &p, &eff, &err)) { free(eff); free(p.filename); goto fail; }
    free(url); url = eff;
    pthread_mutex_lock(&lk);
    if (!j->name) {     /* download direto: nome do servidor ou da URL */
      char *nm = p.filename ? xstrdup(p.filename) : NULL;
      if (!nm) {
        char *u = xstrdup(j->url);
        char *q = strpbrk(u, "?#"); if (q) *q = 0;
        nm = xstrdup(path_basename(u));
        url_decode_inplace(nm);
        free(u);
      }
      if (!*nm) { free(nm); nm = xstrdup("download"); }
      sanitize_component(nm);
      j->name = nm;
    }
    if (!j->final_path) {
      char *rel = sanitize_relpath(j->name);
      char *fp = path_join(j->dest_dir, rel);
      j->final_path = path_unique(fp);
      free(fp); free(rel);
    }
    if (p.total > 0) j->size = p.total;
    j->ranges = p.ranges && j->size > 0;
    int conns = 1;
    pthread_mutex_lock(&g_cfg_lock); conns = g_cfg.connections; pthread_mutex_unlock(&g_cfg_lock);
    if (!j->ranges || j->size < MIN_SEG_FILE) conns = 1;
    j->nseg = conns;
    j->segs = calloc(conns, sizeof(seg_t));
    if (j->size > 0) {
      int64_t chunk = j->size / conns;
      for (int i = 0; i < conns; i++) {
        j->segs[i].start = i * chunk;
        j->segs[i].end = (i == conns - 1) ? j->size - 1 : (i + 1) * chunk - 1;
      }
    } else {
      j->segs[0].start = 0; j->segs[0].end = -1;
    }
    dirty = true;
    pthread_mutex_unlock(&lk);
    free(p.filename);
  }

  /* espaço livre */
  {
    char *dir = path_dirname(j->final_path);
    mkdirs(dir);
    int64_t need = job_remaining(j), freeb = disk_free(dir);
    free(dir);
    if (need > 0 && freeb >= 0 && freeb < need + SPACE_MARGIN) {
      err = str_printf("Espaço insuficiente: precisa %.1f GB, livre %.1f GB",
                       need / 1073741824.0, freeb / 1073741824.0);
      goto fail;
    }
  }

  {
    char *pp = part_path(j);
    fd = open(pp, O_RDWR | O_CREAT, 0666);
    free(pp);
    if (fd < 0) { err = str_printf("Não foi possível criar o arquivo: %s", strerror(errno)); goto fail; }
    if (!j->ranges) {          /* sem retomada: recomeça */
      j->segs[0].done = 0;
      if (ftruncate(fd, 0)) { /* ignora */ }
    }
  }

  for (;;) {
    int n = j->nseg;
    pthread_t th[8];
    segctx_t ctx[8];
    int started = 0;
    for (int i = 0; i < n && i < 8; i++) {
      if (seg_complete(&j->segs[i])) continue;
      ctx[started] = (segctx_t){ .job = j, .seg = &j->segs[i], .fd = fd, .url = url };
      pthread_create(&th[started], NULL, seg_thread, &ctx[started]);
      started++;
    }
    bool relink = false;
    for (int i = 0; i < started; i++) {
      pthread_join(th[i], NULL);
      if (ctx[i].relink) relink = true;
      if (ctx[i].err && !err) err = ctx[i].err; else free(ctx[i].err);
    }
    if (j->abort) break;
    if (err) goto fail;
    bool all = true;
    for (int i = 0; i < n; i++) if (!seg_complete(&j->segs[i])) all = false;
    if (all) break;
    if (relink && relinks < 3) {
      relinks++;
      LOG("job %d: link expirou, pedindo outro", j->id);
      free(url);
      url = resolve_url(j, &err);
      if (!url) goto fail;
      continue;
    }
    err = xstrdup(relink ? "Link de download expirou" : "Download incompleto");
    goto fail;
  }

  if (fd >= 0) { fsync(fd); close(fd); fd = -1; }

  if (j->abort) {
    pthread_mutex_lock(&lk);
    if (j->abort == 2) {
      char *pp = part_path(j); unlink(pp); free(pp);
      j->running = false;
      remove_job_locked(j);
      pthread_mutex_unlock(&lk);
    } else {
      set_state(j, "paused", NULL);
      j->abort = 0; j->running = false; j->speed = 0;
      pthread_mutex_unlock(&lk);
    }
    free(url);
    return NULL;
  }

  {
    char *pp = part_path(j);
    if (j->size < 0) j->size = job_done_bytes(j);
    if (file_exists(j->final_path)) { char *u = path_unique(j->final_path); free(j->final_path); j->final_path = u; }
    if (rename(pp, j->final_path)) {
      err = str_printf("Falha ao finalizar o arquivo: %s", strerror(errno));
      free(pp);
      goto fail;
    }
    free(pp);
  }
  pthread_mutex_lock(&lk);
  set_state(j, "done", NULL);
  j->finished = now_sec();
  j->running = false; j->speed = 0;
  char *fp = xstrdup(j->final_path);
  char *disp = xstrdup(path_basename(j->final_path));
  bool xe = j->x_extract, xd = j->x_delete;
  pthread_mutex_unlock(&lk);
  LOG("concluído: %s", fp);
  platform_notify("Download concluído: %s", disp);
  maybe_delete_from_cloud(j);
  tasks_on_download_done(fp, xe, xd);
  free(fp); free(disp); free(url);
  return NULL;

fail:
  if (fd >= 0) close(fd);
  pthread_mutex_lock(&lk);
  if (j->abort == 2) {
    if (j->final_path) { char *pp = part_path(j); unlink(pp); free(pp); }
    j->running = false;
    remove_job_locked(j);
    pthread_mutex_unlock(&lk);
  } else if (j->abort == 1) {
    set_state(j, "paused", NULL);
    j->abort = 0; j->running = false; j->speed = 0;
    pthread_mutex_unlock(&lk);
  } else {
    LOG("job %d falhou: %s", j->id, err ? err : "?");
    set_state(j, "error", err ? err : "Erro desconhecido");
    j->running = false; j->speed = 0;
    char *disp = xstrdup(j->name ? path_basename(j->name) : "download");
    pthread_mutex_unlock(&lk);
    platform_notify("Falha no download: %s", disp);
    free(disp);
  }
  free(err); free(url);
  return NULL;
}

/* ---------- despachante ---------- */
int dl_active_count(void) {
  int n = 0;
  pthread_mutex_lock(&lk);
  for (int i = 0; i < njobs; i++) if (jobs[i]->running) n++;
  pthread_mutex_unlock(&lk);
  return n;
}

int64_t dl_total_speed(void) {
  int64_t s = 0;
  pthread_mutex_lock(&lk);
  for (int i = 0; i < njobs; i++) s += jobs[i]->speed;
  pthread_mutex_unlock(&lk);
  return s;
}

static void *dispatcher(void *arg) {
  (void)arg;
  double last_speed = now_sec(), last_save = now_sec(), last_tick = 0;
  while (!g_stop) {
    pthread_mutex_lock(&g_cfg_lock);
    int maxp = g_cfg.max_parallel;
    bool nosleep = g_cfg.prevent_sleep;
    pthread_mutex_unlock(&g_cfg_lock);

    pthread_mutex_lock(&lk);
    int running = 0;
    for (int i = 0; i < njobs; i++) if (jobs[i]->running) running++;
    for (int i = 0; i < njobs && running < maxp; i++) {
      job_t *j = jobs[i];
      if (!j->running && !strcmp(j->state, "queued")) {
        j->running = true;
        j->abort = 0;
        set_state(j, "downloading", NULL);
        j->last_bytes = job_done_bytes(j);
        pthread_t t;
        pthread_attr_t at;
        pthread_attr_init(&at);
        pthread_attr_setdetachstate(&at, PTHREAD_CREATE_DETACHED);
        pthread_create(&t, &at, job_thread, j);
        pthread_attr_destroy(&at);
        running++;
      }
    }
    double t = now_sec();
    if (t - last_speed >= 1.0) {
      double dt = t - last_speed;
      for (int i = 0; i < njobs; i++) {
        job_t *j = jobs[i];
        int64_t b = job_done_bytes(j);
        if (j->running) {
          int64_t inst = (int64_t)((b - j->last_bytes) / dt);
          j->speed = j->speed ? (j->speed * 6 + inst * 4) / 10 : inst;
        }
        j->last_bytes = b;
      }
      last_speed = t;
    }
    if ((dirty && t - last_save >= 2.0) || (running && t - last_save >= 10.0)) {
      save_locked();
      last_save = t;
    }
    pthread_mutex_unlock(&lk);

    if (nosleep && (running || tasks_active_count()) && t - last_tick >= 20) {
      platform_power_tick();
      last_tick = t;
    }
    msleep(250);
  }
  return NULL;
}

void dl_init(void) {
  pthread_mutex_lock(&lk);
  load_jobs();
  pthread_mutex_unlock(&lk);
  pthread_create(&disp_thread, NULL, dispatcher, NULL);
}

void dl_shutdown(void) {
  int ids[256], nids = 0;
  pthread_mutex_lock(&lk);
  for (int i = 0; i < njobs; i++) if (jobs[i]->running) {
    jobs[i]->abort = 1;
    if (nids < 256) ids[nids++] = jobs[i]->id;
  }
  pthread_mutex_unlock(&lk);
  for (int k = 0; k < 80 && dl_active_count(); k++) msleep(100);
  pthread_mutex_lock(&lk);
  /* ao reabrir o app, retoma o que estava baixando */
  for (int k = 0; k < nids; k++) {
    job_t *j = find_job(ids[k]);
    if (j && !strcmp(j->state, "paused")) set_state(j, "queued", NULL);
  }
  save_locked();
  pthread_mutex_unlock(&lk);
}

/* ---------- API pública ---------- */
cJSON *dl_jobs_json(void) {
  cJSON *a = cJSON_CreateArray();
  pthread_mutex_lock(&lk);
  for (int i = 0; i < njobs; i++) cJSON_AddItemToArray(a, job_to_json(jobs[i], false));
  pthread_mutex_unlock(&lk);
  return a;
}

static int check_dest(const char *dest, char **err) {
  if (!dest || !*dest || !path_allowed(dest)) { *err = xstrdup("Pasta de destino inválida"); return -1; }
  if (mkdirs(dest)) { *err = str_printf("Não foi possível criar a pasta %s", dest); return -1; }
  return 0;
}

int dl_add_torbox(const char *kind, int64_t item_id, int64_t file_id,
                  const char *name, int64_t size, const char *dest_dir,
                  bool x_extract, bool x_delete, char **err) {
  if (check_dest(dest_dir, err)) return -1;
  job_t *j = calloc(1, sizeof *j);
  j->x_extract = x_extract; j->x_delete = x_delete;
  j->type = xstrdup("torbox");
  j->tb_kind = xstrdup(kind);
  j->item_id = item_id;
  j->file_id = file_id;
  j->name = sanitize_relpath(name);
  j->dest_dir = xstrdup(dest_dir);
  j->size = size > 0 ? size : -1;
  j->state = xstrdup("queued");
  j->error = xstrdup("");
  j->created = now_sec();
  pthread_mutex_lock(&lk);
  /* evita duplicar um download que já está na fila */
  for (int i = 0; i < njobs; i++) {
    job_t *o = jobs[i];
    if (!strcmp(o->type, "torbox") && o->item_id == item_id && o->file_id == file_id &&
        !strcmp(o->tb_kind, kind) && !strcmp(o->dest_dir, dest_dir) && strcmp(o->state, "done")) {
      pthread_mutex_unlock(&lk);
      free_job(j);
      *err = xstrdup("Esse arquivo já está na fila");
      return -1;
    }
  }
  char *fp = path_join(dest_dir, j->name);
  j->final_path = path_unique(fp);
  free(fp);
  j->id = next_id++;
  add_job_locked(j);
  int id = j->id;
  pthread_mutex_unlock(&lk);
  return id;
}

int dl_add_direct(const char *url, const char *dest_dir, bool x_extract, bool x_delete, char **err) {
  if (strncasecmp(url, "http://", 7) && strncasecmp(url, "https://", 8)) {
    *err = xstrdup("O link direto precisa começar com http:// ou https://");
    return -1;
  }
  if (check_dest(dest_dir, err)) return -1;
  job_t *j = calloc(1, sizeof *j);
  j->x_extract = x_extract; j->x_delete = x_delete;
  j->type = xstrdup("direct");
  j->url = xstrdup(url);
  j->dest_dir = xstrdup(dest_dir);
  j->size = -1;
  j->state = xstrdup("queued");
  j->error = xstrdup("");
  j->created = now_sec();
  pthread_mutex_lock(&lk);
  j->id = next_id++;
  add_job_locked(j);
  int id = j->id;
  pthread_mutex_unlock(&lk);
  return id;
}

int dl_action(int id, const char *action, char **err) {
  pthread_mutex_lock(&lk);
  job_t *j = find_job(id);
  if (!j) { pthread_mutex_unlock(&lk); *err = xstrdup("Download não encontrado"); return -1; }
  int r = 0;
  if (!strcmp(action, "pause")) {
    if (j->running) j->abort = 1;
    else if (!strcmp(j->state, "queued")) set_state(j, "paused", NULL);
  } else if (!strcmp(action, "resume") || !strcmp(action, "retry")) {
    if (!j->running && (!strcmp(j->state, "paused") || !strcmp(j->state, "error"))) {
      if (!strcmp(j->state, "error") && !j->ranges && j->segs) { free(j->segs); j->segs = NULL; j->nseg = 0; }
      set_state(j, "queued", NULL);
    }
  } else if (!strcmp(action, "cancel")) {
    if (j->running) j->abort = 2;
    else {
      if (strcmp(j->state, "done") && j->final_path) { char *pp = part_path(j); unlink(pp); free(pp); }
      remove_job_locked(j);
    }
  } else if (!strcmp(action, "remove")) {
    if (j->running) { *err = xstrdup("Pause ou cancele antes de remover"); r = -1; }
    else remove_job_locked(j);
  } else if (!strcmp(action, "top")) {
    for (int i = 0; i < njobs; i++) if (jobs[i] == j) {
      memmove(&jobs[1], &jobs[0], i * sizeof(job_t *));
      jobs[0] = j;
      dirty = true;
      break;
    }
  } else {
    *err = xstrdup("Ação inválida");
    r = -1;
  }
  pthread_mutex_unlock(&lk);
  return r;
}

void dl_clear_finished(void) {
  pthread_mutex_lock(&lk);
  for (int i = njobs - 1; i >= 0; i--) if (!strcmp(jobs[i]->state, "done")) remove_job_locked(jobs[i]);
  pthread_mutex_unlock(&lk);
}

bool dl_path_pending(const char *final_path) {
  bool r = false;
  pthread_mutex_lock(&lk);
  for (int i = 0; i < njobs && !r; i++) {
    job_t *j = jobs[i];
    if (j->final_path && !strcmp(j->final_path, final_path) && strcmp(j->state, "done")) r = true;
  }
  pthread_mutex_unlock(&lk);
  return r;
}

char **dl_pending_paths(int *n) {
  pthread_mutex_lock(&lk);
  char **v = calloc(njobs + 1, sizeof(char *));
  int c = 0;
  for (int i = 0; i < njobs; i++)
    if (jobs[i]->final_path && strcmp(jobs[i]->state, "done")) v[c++] = xstrdup(jobs[i]->final_path);
  pthread_mutex_unlock(&lk);
  *n = c;
  return v;
}

/* ---------- "baixar quando ficar pronto": acompanha itens recém-adicionados no TorBox ---------- */
typedef struct { char *kind; int64_t id; char *dest; bool xe, xd; double since; } watch_t;
static watch_t watches[64];
static int nwatch;
static pthread_mutex_t wlk = PTHREAD_MUTEX_INITIALIZER;

static void watches_save_locked(void) {
  cJSON *a = cJSON_CreateArray();
  for (int i = 0; i < nwatch; i++) {
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "kind", watches[i].kind);
    cJSON_AddNumberToObject(o, "id", (double)watches[i].id);
    cJSON_AddStringToObject(o, "dest", watches[i].dest);
    cJSON_AddBoolToObject(o, "xe", watches[i].xe);
    cJSON_AddBoolToObject(o, "xd", watches[i].xd);
    cJSON_AddNumberToObject(o, "since", watches[i].since);
    cJSON_AddItemToArray(a, o);
  }
  char *txt = cJSON_PrintUnformatted(a);
  char *p = path_join(g_data_dir, "watches.json");
  write_file_atomic(p, txt, strlen(txt));
  free(p); free(txt);
  cJSON_Delete(a);
}

int dl_watch_add(const char *kind, int64_t id, const char *dest, bool xe, bool xd, char **err) {
  if (check_dest(dest, err)) return -1;
  pthread_mutex_lock(&wlk);
  if (nwatch >= 64) { pthread_mutex_unlock(&wlk); *err = xstrdup("Muitos itens aguardando"); return -1; }
  watches[nwatch++] = (watch_t){ xstrdup(kind), id, xstrdup(dest), xe, xd, now_sec() };
  watches_save_locked();
  pthread_mutex_unlock(&wlk);
  return 0;
}

cJSON *dl_watches_json(void) {
  cJSON *a = cJSON_CreateArray();
  pthread_mutex_lock(&wlk);
  for (int i = 0; i < nwatch; i++) {
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "kind", watches[i].kind);
    cJSON_AddNumberToObject(o, "id", (double)watches[i].id);
    cJSON_AddStringToObject(o, "dest", watches[i].dest);
    cJSON_AddItemToArray(a, o);
  }
  pthread_mutex_unlock(&wlk);
  return a;
}

void dl_watch_remove(const char *kind, int64_t id) {
  pthread_mutex_lock(&wlk);
  for (int i = 0; i < nwatch; i++) {
    if (watches[i].id == id && !strcmp(watches[i].kind, kind)) {
      free(watches[i].kind); free(watches[i].dest);
      watches[i] = watches[--nwatch];
      break;
    }
  }
  watches_save_locked();
  pthread_mutex_unlock(&wlk);
}

static void *watcher(void *arg) {
  (void)arg;
  int tick = 0;
  while (!g_stop) {
    msleep(1000);
    if (++tick < 20) continue;      /* a cada ~20 s */
    tick = 0;
    pthread_mutex_lock(&wlk);
    int n = nwatch;
    pthread_mutex_unlock(&wlk);
    if (!n) continue;
    static const char *kinds[] = { "torrents", "usenet", "webdl" };
    for (int k = 0; k < 3; k++) {
      pthread_mutex_lock(&wlk);
      bool any = false;
      for (int i = 0; i < nwatch; i++) if (!strcmp(watches[i].kind, kinds[k])) any = true;
      pthread_mutex_unlock(&wlk);
      if (!any) continue;
      char *err = NULL;
      cJSON *list = torbox_list(kinds[k], &err);
      if (!list) { free(err); continue; }
      cJSON *it;
      cJSON_ArrayForEach(it, list) {
        int64_t id = (int64_t)cJSON_GetObjectItem(it, "id")->valuedouble;
        bool ready = cJSON_IsTrue(cJSON_GetObjectItem(it, "finished")) || cJSON_IsTrue(cJSON_GetObjectItem(it, "present"));
        cJSON *files = cJSON_GetObjectItem(it, "files");
        if (!ready || cJSON_GetArraySize(files) == 0) continue;
        pthread_mutex_lock(&wlk);
        int wi = -1;
        for (int i = 0; i < nwatch; i++) if (watches[i].id == id && !strcmp(watches[i].kind, kinds[k])) wi = i;
        watch_t w = {0};
        if (wi >= 0) { w = watches[wi]; w.kind = xstrdup(w.kind); w.dest = xstrdup(w.dest); }
        pthread_mutex_unlock(&wlk);
        if (wi < 0) continue;
        cJSON *f;
        int added = 0;
        cJSON_ArrayForEach(f, files) {
          char *e2 = NULL;
          if (dl_add_torbox(kinds[k], id, (int64_t)cJSON_GetObjectItem(f, "id")->valuedouble,
                            cJSON_GetObjectItem(f, "name")->valuestring,
                            (int64_t)cJSON_GetObjectItem(f, "size")->valuedouble, w.dest, w.xe, w.xd, &e2) > 0) added++;
          free(e2);
        }
        LOG("item %lld pronto no TorBox: %d arquivo(s) na fila", (long long)id, added);
        platform_notify("Pronto no TorBox, baixando: %s", cJSON_GetObjectItem(it, "name")->valuestring);
        dl_watch_remove(kinds[k], id);
        free(w.kind); free(w.dest);
      }
      cJSON_Delete(list);
    }
  }
  return NULL;
}

void dl_watch_init(void) {
  char *p = path_join(g_data_dir, "watches.json");
  char *txt = read_file(p, NULL);
  free(p);
  if (txt) {
    cJSON *a = cJSON_Parse(txt);
    cJSON *o;
    cJSON_ArrayForEach(o, a) {
      if (nwatch >= 64) break;
      watches[nwatch++] = (watch_t){ xstrdup(js(o, "kind")), (int64_t)jnumv(o, "id"), xstrdup(js(o, "dest")),
                                     cJSON_IsTrue(cJSON_GetObjectItem(o, "xe")), cJSON_IsTrue(cJSON_GetObjectItem(o, "xd")),
                                     jnumv(o, "since") };
    }
    cJSON_Delete(a);
    free(txt);
  }
  pthread_t t;
  pthread_create(&t, NULL, watcher, NULL);
  pthread_detach(t);
}
