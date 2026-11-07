/* Rotas HTTP: arquivos estáticos da interface + API JSON. */
#include "nimbo.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>

static void json_resp(resp_t *rs, int status, cJSON *j) {
  rs->status = status;
  rs->content_type = "application/json; charset=utf-8";
  rs->body = cJSON_PrintUnformatted(j);
  rs->body_len = strlen(rs->body);
  cJSON_Delete(j);
}

static void ok_resp(resp_t *rs) {
  cJSON *j = cJSON_CreateObject();
  cJSON_AddBoolToObject(j, "ok", true);
  json_resp(rs, 200, j);
}

static void err_resp(resp_t *rs, int status, const char *msg) {
  cJSON *j = cJSON_CreateObject();
  cJSON_AddStringToObject(j, "error", msg ? msg : "erro");
  json_resp(rs, status, j);
}

static void err_take(resp_t *rs, char *msg) { err_resp(rs, 400, msg); free(msg); }

static const char *jstr(cJSON *o, const char *k) {
  cJSON *v = cJSON_GetObjectItem(o, k);
  return cJSON_IsString(v) ? v->valuestring : NULL;
}
static double jnum(cJSON *o, const char *k, double def) {
  cJSON *v = cJSON_GetObjectItem(o, k);
  return cJSON_IsNumber(v) ? v->valuedouble : def;
}
static bool jbool(cJSON *o, const char *k, bool def) {
  cJSON *v = cJSON_GetObjectItem(o, k);
  return cJSON_IsBool(v) ? cJSON_IsTrue(v) : def;
}

static const char *mime_for(const char *p) {
  static const struct { const char *ext, *mime; } m[] = {
    { ".mp4", "video/mp4" }, { ".m4v", "video/mp4" }, { ".webm", "video/webm" }, { ".mkv", "video/x-matroska" },
    { ".mp3", "audio/mpeg" }, { ".m4a", "audio/mp4" }, { ".flac", "audio/flac" }, { ".ogg", "audio/ogg" },
    { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".png", "image/png" }, { ".gif", "image/gif" },
    { ".webp", "image/webp" }, { ".txt", "text/plain; charset=utf-8" }, { ".nfo", "text/plain; charset=utf-8" },
    { ".srt", "text/plain; charset=utf-8" }, { ".json", "application/json" }, { ".pdf", "application/pdf" },
    { NULL, NULL } };
  for (int i = 0; m[i].ext; i++) if (str_ends_with_ci(p, m[i].ext)) return m[i].mime;
  return "application/octet-stream";
}

/* GET /api/fs/file?path=...&dl=1 — com suporte a Range (vídeo no navegador, retomada) */
static void serve_file(req_t *rq, resp_t *rs) {
  char *p = query_get(rq->query, "path");
  char *dl = query_get(rq->query, "dl");
  char *err = NULL;
  char *np = p ? storage_resolve(p, &err) : NULL;
  free(p);
  if (!np) { free(dl); err_take(rs, err ? err : xstrdup("Caminho inválido")); return; }
  int fd = open(np, O_RDONLY);
  struct stat st;
  if (fd < 0 || fstat(fd, &st) || !S_ISREG(st.st_mode)) {
    if (fd >= 0) close(fd);
    free(np); free(dl);
    err_resp(rs, 404, "Arquivo não encontrado");
    return;
  }
  int64_t size = st.st_size, start = 0, end = size - 1;
  rs->status = 200;
  if (rq->range && !strncmp(rq->range, "bytes=", 6)) {
    char *dash = strchr(rq->range + 6, '-');
    if (dash) {
      if (dash == rq->range + 6) { int64_t suf = strtoll(dash + 1, NULL, 10); start = size - suf; if (start < 0) start = 0; }
      else { start = strtoll(rq->range + 6, NULL, 10); if (dash[1]) end = strtoll(dash + 1, NULL, 10); }
      if (end >= size) end = size - 1;
      if (start > end || start >= size) {
        close(fd);
        rs->status = 416;
        rs->extra_headers = str_printf("Content-Range: bytes */%lld\r\n", (long long)size);
        rs->body = xstrdup("");
        free(np); free(dl);
        return;
      }
      rs->status = 206;
    }
  }
  char *fname = url_encode(path_basename(np));
  if (rs->status == 206)
    rs->extra_headers = str_printf("Accept-Ranges: bytes\r\nContent-Range: bytes %lld-%lld/%lld\r\n"
                                   "Content-Disposition: %s; filename*=UTF-8''%s\r\n",
                                   (long long)start, (long long)end, (long long)size,
                                   dl && *dl == '1' ? "attachment" : "inline", fname);
  else
    rs->extra_headers = str_printf("Accept-Ranges: bytes\r\nContent-Disposition: %s; filename*=UTF-8''%s\r\n",
                                   dl && *dl == '1' ? "attachment" : "inline", fname);
  free(fname);
  rs->content_type = (dl && *dl == '1') ? "application/octet-stream" : mime_for(np);
  rs->file_fd = fd;
  rs->file_off = start;
  rs->file_len = end - start + 1;
  free(np); free(dl);
}

static void serve_asset(const char *path, resp_t *rs) {
  if (!strcmp(path, "/")) path = "/index.html";
  for (size_t i = 0; i < g_assets_count; i++) {
    if (!strcmp(g_assets[i].path, path)) {
      rs->status = 200;
      rs->content_type = g_assets[i].mime;
      rs->static_body = g_assets[i].data;
      rs->body_len = g_assets[i].len;
      return;
    }
  }
  err_resp(rs, 404, "não encontrado");
}

static cJSON *status_json(void) {
  cJSON *j = cJSON_CreateObject();
  cJSON_AddStringToObject(j, "version", NIMBO_VERSION);
  char *ip = platform_local_ip();
  cJSON_AddStringToObject(j, "ip", ip);
  free(ip);
  pthread_mutex_lock(&g_cfg_lock);
  cJSON_AddNumberToObject(j, "port", g_cfg.port);
  cJSON_AddBoolToObject(j, "has_key", *g_cfg.api_key != 0);
  cJSON_AddBoolToObject(j, "speed_limit_on", g_cfg.speed_limit_on);
  cJSON_AddNumberToObject(j, "speed_limit_kbps", g_cfg.speed_limit_kbps);
  pthread_mutex_unlock(&g_cfg_lock);
#ifdef __PROSPERO__
  cJSON_AddBoolToObject(j, "ps5", true);
#else
  cJSON_AddBoolToObject(j, "ps5", false);
#endif
  cJSON_AddNumberToObject(j, "speed", (double)dl_total_speed());
  cJSON_AddNumberToObject(j, "active", dl_active_count());
  cJSON_AddNumberToObject(j, "tasks_active", tasks_active_count());
  return j;
}

static int path_id(const char *path, const char *prefix, char *action, size_t alen) {
  /* "/api/jobs/12/pause" -> 12, "pause" */
  size_t pl = strlen(prefix);
  if (strncmp(path, prefix, pl)) return -1;
  const char *p = path + pl;
  char *end;
  long id = strtol(p, &end, 10);
  if (end == p || *end != '/') return -1;
  snprintf(action, alen, "%s", end + 1);
  return (int)id;
}

void api_handle(req_t *rq, resp_t *rs) {
  const char *p = rq->path;
  bool get = !strcmp(rq->method, "GET") || !strcmp(rq->method, "HEAD");
  bool post = !strcmp(rq->method, "POST");
  if (strncmp(p, "/api/", 5)) {
    if (get) serve_asset(p, rs); else err_resp(rs, 405, "método");
    return;
  }
  cJSON *body = (post && rq->body_len) ? cJSON_Parse(rq->body) : NULL;
  if (!body) body = cJSON_CreateObject();
  char *err = NULL;
  char action[32];
  int id;

  if (get && !strcmp(p, "/api/status")) {
    json_resp(rs, 200, status_json());
  } else if (get && !strcmp(p, "/api/overview")) {      /* tudo que a tela de downloads precisa */
    cJSON *j = status_json();
    cJSON_AddItemToObject(j, "jobs", dl_jobs_json());
    cJSON_AddItemToObject(j, "tasks", tasks_json());
    cJSON_AddItemToObject(j, "watches", dl_watches_json());
    json_resp(rs, 200, j);
  } else if (get && !strcmp(p, "/api/config")) {
    json_resp(rs, 200, config_to_json(true));
  } else if (post && !strcmp(p, "/api/config")) {
    config_update(body);
    json_resp(rs, 200, config_to_json(true));
  } else if (get && !strcmp(p, "/api/storage")) {
    json_resp(rs, 200, storage_list());
  } else if (post && !strcmp(p, "/api/auth/start")) {
    cJSON *j = torbox_auth_start(&err);
    if (j) json_resp(rs, 200, j); else err_take(rs, err);
  } else if (get && !strcmp(p, "/api/auth/status")) {
    json_resp(rs, 200, torbox_auth_status());
  } else if (post && !strcmp(p, "/api/auth/cancel")) {
    torbox_auth_cancel();
    ok_resp(rs);
  } else if (get && !strcmp(p, "/api/account")) {
    cJSON *j = torbox_me(&err);
    if (j) json_resp(rs, 200, j); else err_take(rs, err);
  } else if (get && !strcmp(p, "/api/cloud")) {
    char *kind = query_get(rq->query, "kind");
    cJSON *j = torbox_list(kind ? kind : "torrents", &err);
    free(kind);
    if (j) json_resp(rs, 200, j); else err_take(rs, err);
  } else if (post && !strcmp(p, "/api/cloud/add")) {
    /* {link, auto_download, dest, extract, delete_archive} */
    const char *link = jstr(body, "link");
    cJSON *j = link ? torbox_add(link, &err) : NULL;
    if (j) {
      const char *dest = jstr(body, "dest");
      int64_t nid = (int64_t)jnum(j, "id", 0);
      if (jbool(body, "auto_download", false) && dest && nid > 0) {
        pthread_mutex_lock(&g_cfg_lock);
        bool dx = g_cfg.auto_extract, dd = g_cfg.delete_after_extract;
        pthread_mutex_unlock(&g_cfg_lock);
        char *e2 = NULL;
        if (dl_watch_add(jstr(j, "kind"), nid, dest, jbool(body, "extract", dx), jbool(body, "delete_archive", dd), &e2) == 0)
          cJSON_AddBoolToObject(j, "watching", true);
        else { cJSON_AddStringToObject(j, "watch_error", e2); free(e2); }
      }
      json_resp(rs, 200, j);
    } else err_take(rs, err ? err : xstrdup("Informe o link"));
  } else if (post && !strcmp(p, "/api/cloud/watch")) {
    const char *kind = jstr(body, "kind"), *dest = jstr(body, "dest");
    pthread_mutex_lock(&g_cfg_lock);
    bool dx = g_cfg.auto_extract, dd = g_cfg.delete_after_extract;
    pthread_mutex_unlock(&g_cfg_lock);
    if (kind && dest && dl_watch_add(kind, (int64_t)jnum(body, "id", 0), dest, jbool(body, "extract", dx),
                                     jbool(body, "delete_archive", dd), &err) == 0) ok_resp(rs);
    else err_take(rs, err ? err : xstrdup("Parâmetros inválidos"));
  } else if (post && !strcmp(p, "/api/watch/remove")) {
    const char *kind = jstr(body, "kind");
    if (kind) dl_watch_remove(kind, (int64_t)jnum(body, "id", 0));
    ok_resp(rs);
  } else if (post && !strcmp(p, "/api/cloud/delete")) {
    const char *kind = jstr(body, "kind");
    if (kind && torbox_delete(kind, (int64_t)jnum(body, "id", 0), &err) == 0) ok_resp(rs);
    else err_take(rs, err ? err : xstrdup("Parâmetros inválidos"));
  } else if (post && !strcmp(p, "/api/download")) {
    /* {dest, extract, delete_archive, items:[{kind,item_id,file_id,name,size}]} ou {dest, url} */
    const char *dest = jstr(body, "dest");
    pthread_mutex_lock(&g_cfg_lock);
    bool dx = g_cfg.auto_extract, dd = g_cfg.delete_after_extract;
    pthread_mutex_unlock(&g_cfg_lock);
    bool xe = jbool(body, "extract", dx), xd = jbool(body, "delete_archive", dd);
    const char *url = jstr(body, "url");
    if (dest && jbool(body, "remember", false)) {
      cJSON *c = cJSON_CreateObject();
      cJSON_AddStringToObject(c, "default_dest", dest);
      config_update(c);
      cJSON_Delete(c);
    }
    cJSON *res = cJSON_CreateObject();
    cJSON *ids = cJSON_AddArrayToObject(res, "ids");
    cJSON *errs = cJSON_AddArrayToObject(res, "errors");
    if (url) {
      int r = dl_add_direct(url, dest, xe, xd, &err);
      if (r > 0) cJSON_AddItemToArray(ids, cJSON_CreateNumber(r));
      else { cJSON_AddItemToArray(errs, cJSON_CreateString(err)); free(err); err = NULL; }
    } else {
      cJSON *it;
      cJSON_ArrayForEach(it, cJSON_GetObjectItem(body, "items")) {
        const char *kind = jstr(it, "kind"), *name = jstr(it, "name");
        if (!kind || !name) continue;
        int r = dl_add_torbox(kind, (int64_t)jnum(it, "item_id", 0), (int64_t)jnum(it, "file_id", 0),
                              name, (int64_t)jnum(it, "size", -1), dest, xe, xd, &err);
        if (r > 0) cJSON_AddItemToArray(ids, cJSON_CreateNumber(r));
        else { cJSON_AddItemToArray(errs, cJSON_CreateString(err)); free(err); err = NULL; }
      }
    }
    int nok = cJSON_GetArraySize(ids);
    json_resp(rs, nok || !cJSON_GetArraySize(errs) ? 200 : 400, res);
  } else if (get && !strcmp(p, "/api/jobs")) {
    json_resp(rs, 200, dl_jobs_json());
  } else if (post && !strcmp(p, "/api/jobs/clear")) {
    dl_clear_finished();
    ok_resp(rs);
  } else if (post && (id = path_id(p, "/api/jobs/", action, sizeof action)) > 0) {
    if (dl_action(id, action, &err) == 0) ok_resp(rs); else err_take(rs, err);
  } else if (get && !strcmp(p, "/api/tasks")) {
    json_resp(rs, 200, tasks_json());
  } else if (post && !strcmp(p, "/api/tasks/clear")) {
    tasks_clear_finished();
    ok_resp(rs);
  } else if (post && (id = path_id(p, "/api/tasks/", action, sizeof action)) > 0) {
    if (tasks_action(id, action, &err) == 0) ok_resp(rs); else err_take(rs, err);
  } else if (post && !strcmp(p, "/api/extract")) {
    const char *path = jstr(body, "path");
    pthread_mutex_lock(&g_cfg_lock);
    bool dd = g_cfg.delete_after_extract;
    pthread_mutex_unlock(&g_cfg_lock);
    char *first = path ? archive_first_volume(path) : NULL;
    int r = first ? tasks_extract(first, false, jbool(body, "delete_archive", dd), &err) : -1;
    free(first);
    if (r > 0) ok_resp(rs); else err_take(rs, err ? err : xstrdup("Não é um arquivo compactado"));
  } else if (get && !strcmp(p, "/api/fs")) {
    char *path = query_get(rq->query, "path");
    cJSON *j = path ? fs_list(path, &err) : NULL;
    free(path);
    if (j) json_resp(rs, 200, j); else err_take(rs, err ? err : xstrdup("Informe a pasta"));
  } else if (get && !strcmp(p, "/api/fs/file")) {
    serve_file(rq, rs);
  } else if (post && !strcmp(p, "/api/fs/mkdir")) {
    const char *path = jstr(body, "path"), *name = jstr(body, "name");
    char *np = path ? storage_resolve(path, &err) : NULL;
    if (np && name && *name) {
      char *nm = xstrdup(name);
      sanitize_component(nm);
      char *full = path_join(np, nm);
      if (mkdirs(full) == 0) ok_resp(rs); else err_resp(rs, 400, "Não foi possível criar a pasta");
      free(full); free(nm);
    } else err_take(rs, err ? err : xstrdup("Nome inválido"));
    free(np);
  } else if (post && !strcmp(p, "/api/fs/rename")) {
    const char *path = jstr(body, "path"), *name = jstr(body, "name");
    char *np = path ? storage_resolve(path, &err) : NULL;
    if (np && name && *name && !strchr(name, '/')) {
      char *nm = xstrdup(name);
      sanitize_component(nm);
      char *dir = path_dirname(np);
      char *dst = path_join(dir, nm);
      if (file_exists(dst)) err_resp(rs, 400, "Já existe um item com esse nome");
      else if (rename(np, dst) == 0) ok_resp(rs);
      else { char *m = str_printf("Falha ao renomear: %s", strerror(errno)); err_take(rs, m); }
      free(dst); free(dir); free(nm);
    } else err_take(rs, err ? err : xstrdup("Nome inválido"));
    free(np);
  } else if (post && !strcmp(p, "/api/fs/delete")) {
    const char *path = jstr(body, "path");
    char *np = path ? storage_resolve(path, &err) : NULL;
    int n;
    cJSON *roots = storage_list();
    bool is_root = false;
    cJSON *r;
    cJSON_ArrayForEach(r, roots) if (np && !strcmp(jstr(r, "path"), np)) is_root = true;
    cJSON_Delete(roots);
    (void)n;
    if (!np) err_take(rs, err);
    else if (is_root) err_resp(rs, 400, "Não é permitido apagar a unidade inteira");
    else {
      int64_t sz = file_size(np);
      bool dir = is_dir(np);
      if (rm_rf(np) == 0) { if (!dir && sz > 0) analyze_forget(np, sz); ok_resp(rs); }
      else { char *m = str_printf("Falha ao apagar: %s", strerror(errno)); err_take(rs, m); }
    }
    free(np);
  } else if (post && (!strcmp(p, "/api/fs/copy") || !strcmp(p, "/api/fs/move"))) {
    const char *src = jstr(body, "src"), *dst = jstr(body, "dest");
    char *ns = src ? storage_resolve(src, &err) : NULL;
    char *nd = (ns && dst) ? storage_resolve(dst, &err) : NULL;
    int rr = (ns && nd) ? tasks_copy(ns, nd, !strcmp(p, "/api/fs/move"), &err) : -1;
    if (rr > 0) ok_resp(rs); else err_take(rs, err ? err : xstrdup("Parâmetros inválidos"));
    free(ns); free(nd);
  } else if (post && !strcmp(p, "/api/analyze")) {
    const char *path = jstr(body, "path");
    if (path && analyze_start(path, &err) == 0) json_resp(rs, 200, analyze_status());
    else err_take(rs, err ? err : xstrdup("Informe a unidade"));
  } else if (get && !strcmp(p, "/api/analyze/status")) {
    json_resp(rs, 200, analyze_status());
  } else if (post && !strcmp(p, "/api/analyze/cancel")) {
    analyze_cancel();
    ok_resp(rs);
  } else if (get && !strcmp(p, "/api/analyze/dir")) {
    char *path = query_get(rq->query, "path");
    cJSON *j = path ? analyze_dir(path, &err) : NULL;
    free(path);
    if (j) json_resp(rs, 200, j); else err_take(rs, err ? err : xstrdup("Informe a pasta"));
  } else if (get && !strcmp(p, "/api/apps")) {
    json_resp(rs, 200, apps_list());
  } else if (get && !strcmp(p, "/api/apps/icon")) {
    char *id = query_get(rq->query, "id");
    char *ip = id ? apps_icon_path(id) : NULL;
    size_t len = 0;
    char *data = ip ? read_file(ip, &len) : NULL;
    free(id); free(ip);
    if (data) { rs->status = 200; rs->content_type = "image/png"; rs->body = data; rs->body_len = len; }
    else err_resp(rs, 404, "sem ícone");
  } else if (post && !strcmp(p, "/api/tile")) {
    pthread_mutex_lock(&g_cfg_lock);
    int port = g_cfg.port;
    pthread_mutex_unlock(&g_cfg_lock);
    if (platform_install_tile(jbool(body, "media", true), true, port) == 0) ok_resp(rs);
    else err_resp(rs, 500, "Não foi possível instalar o atalho");
  } else if (post && !strcmp(p, "/api/quit")) {
    ok_resp(rs);
    g_stop = true;
  } else {
    err_resp(rs, 404, "rota não encontrada");
  }
  cJSON_Delete(body);
}
