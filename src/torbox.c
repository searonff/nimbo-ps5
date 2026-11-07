/* Cliente HTTP (libcurl) e API v1 do TorBox. */
#include "nimbo.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <curl/curl.h>

void http_global_init(void) { curl_global_init(CURL_GLOBAL_DEFAULT); }

void http_setup_common(void *c) {
  CURL *curl = c;
  curl_easy_setopt(curl, CURLOPT_USERAGENT, "NimboPS5/" NIMBO_VERSION);
  curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
  curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 10L);
  curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 20L);
  curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
  curl_easy_setopt(curl, CURLOPT_ACCEPT_ENCODING, "");
#ifdef __PROSPERO__
  struct curl_blob blob = { (void *)g_cacert, g_cacert_len, CURL_BLOB_NOCOPY };
  curl_easy_setopt(curl, CURLOPT_CAINFO_BLOB, &blob);
#endif
}

const char *torbox_base(void) {
  const char *b = getenv("NIMBO_TORBOX_BASE");   /* usado nos testes */
  return b ? b : "https://api.torbox.app/v1/api";
}

static size_t sink(char *p, size_t s, size_t n, void *ud) {
  http_resp_t *r = ud;
  size_t len = s * n;
  r->data = realloc(r->data, r->len + len + 1);
  memcpy(r->data + r->len, p, len);
  r->len += len;
  r->data[r->len] = 0;
  return len;
}

static const char *friendly(const char *err, const char *detail, long code) {
  if (err) {
    if (!strcmp(err, "AUTH_ERROR") || !strcmp(err, "BAD_TOKEN") || !strcmp(err, "NO_AUTH"))
      return "Chave de API inválida. Confira em Configurações.";
    if (!strcmp(err, "PLAN_RESTRICTED_FEATURE")) return "Seu plano do TorBox não permite isso.";
    if (!strcmp(err, "ACTIVE_LIMIT")) return "Limite de downloads ativos no TorBox atingido.";
    if (!strcmp(err, "DOWNLOAD_TOO_LARGE")) return "Arquivo grande demais para o seu plano.";
    if (!strcmp(err, "UNSUPPORTED_SITE") || !strcmp(err, "INVALID_HOSTER")) return "Site/hoster não suportado pelo TorBox.";
  }
  if (code == 429) return "Limite de requisições do TorBox. Tente em instantes.";
  if (detail && *detail) return detail;
  if (err && *err) return err;
  return NULL;
}

/* method GET/POST; form (multipart) opcional; json opcional */
static cJSON *call(const char *method, const char *path, const char *query,
                   cJSON *json_body, const char **form_kv, char **err) {
  char *key = config_api_key();
  if (!*key) { free(key); *err = xstrdup("Configure sua chave de API do TorBox em Configurações."); return NULL; }
  CURL *c = curl_easy_init();
  http_resp_t r = {0};
  char *url = str_printf("%s/%s%s%s", torbox_base(), path, query ? "?" : "", query ? query : "");
  char *auth = str_printf("Authorization: Bearer %s", key);
  struct curl_slist *h = NULL;
  h = curl_slist_append(h, auth);
  h = curl_slist_append(h, "Accept: application/json");
  char *body = NULL;
  curl_mime *mime = NULL;
  http_setup_common(c);
  curl_easy_setopt(c, CURLOPT_URL, url);
  curl_easy_setopt(c, CURLOPT_TIMEOUT, 60L);
  curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, sink);
  curl_easy_setopt(c, CURLOPT_WRITEDATA, &r);
  if (!strcmp(method, "POST")) {
    if (json_body) {
      body = cJSON_PrintUnformatted(json_body);
      h = curl_slist_append(h, "Content-Type: application/json");
      curl_easy_setopt(c, CURLOPT_POSTFIELDS, body);
    } else if (form_kv) {
      mime = curl_mime_init(c);
      for (int i = 0; form_kv[i]; i += 2) {
        curl_mimepart *part = curl_mime_addpart(mime);
        curl_mime_name(part, form_kv[i]);
        curl_mime_data(part, form_kv[i + 1], CURL_ZERO_TERMINATED);
      }
      curl_easy_setopt(c, CURLOPT_MIMEPOST, mime);
    } else {
      curl_easy_setopt(c, CURLOPT_POSTFIELDS, "");
    }
  }
  curl_easy_setopt(c, CURLOPT_HTTPHEADER, h);
  CURLcode rc = curl_easy_perform(c);
  curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &r.status);
  cJSON *res = NULL;
  if (rc != CURLE_OK) {
    *err = str_printf("Sem conexão com o TorBox: %s", curl_easy_strerror(rc));
  } else {
    cJSON *j = r.data ? cJSON_Parse(r.data) : NULL;
    if (!j) {
      const char *f = friendly(NULL, NULL, r.status);
      *err = f ? xstrdup(f) : str_printf("Resposta inválida do TorBox (HTTP %ld)", r.status);
    } else {
      cJSON *succ = cJSON_GetObjectItem(j, "success");
      bool ok = succ ? cJSON_IsTrue(succ) : (r.status >= 200 && r.status < 300);
      if (!ok) {
        cJSON *e = cJSON_GetObjectItem(j, "error"), *d = cJSON_GetObjectItem(j, "detail");
        const char *f = friendly(cJSON_IsString(e) ? e->valuestring : NULL,
                                 cJSON_IsString(d) ? d->valuestring : NULL, r.status);
        *err = f ? xstrdup(f) : str_printf("Erro HTTP %ld", r.status);
        cJSON_Delete(j);
      } else {
        res = j;
      }
    }
  }
  curl_slist_free_all(h);
  if (mime) curl_mime_free(mime);
  curl_easy_cleanup(c);
  free(body); free(url); free(auth); free(key); free(r.data);
  return res;
}

static double num(cJSON *o, const char *k) {
  cJSON *v = cJSON_GetObjectItem(o, k);
  return cJSON_IsNumber(v) ? v->valuedouble : 0;
}
static const char *str(cJSON *o, const char *k) {
  cJSON *v = cJSON_GetObjectItem(o, k);
  return cJSON_IsString(v) ? v->valuestring : "";
}

cJSON *torbox_list(const char *kind, char **err) {
  if (strcmp(kind, "torrents") && strcmp(kind, "usenet") && strcmp(kind, "webdl")) {
    *err = xstrdup("Tipo inválido");
    return NULL;
  }
  char *path = str_printf("%s/mylist", kind);
  cJSON *j = call("GET", path, "bypass_cache=true&limit=1000", NULL, NULL, err);
  free(path);
  if (!j) return NULL;
  cJSON *data = cJSON_GetObjectItem(j, "data");
  cJSON *out = cJSON_CreateArray();
  cJSON *list = data;
  cJSON *single = NULL;
  if (cJSON_IsObject(data)) { single = cJSON_CreateArray(); cJSON_AddItemReferenceToArray(single, data); list = single; }
  cJSON *it;
  cJSON_ArrayForEach(it, list) {
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "kind", kind);
    cJSON_AddNumberToObject(o, "id", num(it, "id"));
    cJSON_AddStringToObject(o, "name", str(it, "name"));
    cJSON_AddNumberToObject(o, "size", num(it, "size"));
    cJSON_AddNumberToObject(o, "progress", num(it, "progress"));
    cJSON_AddNumberToObject(o, "speed", num(it, "download_speed"));
    cJSON_AddNumberToObject(o, "eta", num(it, "eta"));
    cJSON_AddStringToObject(o, "state", str(it, "download_state"));
    cJSON_AddBoolToObject(o, "finished", cJSON_IsTrue(cJSON_GetObjectItem(it, "download_finished")));
    cJSON_AddBoolToObject(o, "present", cJSON_IsTrue(cJSON_GetObjectItem(it, "download_present")));
    cJSON_AddStringToObject(o, "created", str(it, "created_at"));
    cJSON *files = cJSON_AddArrayToObject(o, "files");
    cJSON *f;
    cJSON_ArrayForEach(f, cJSON_GetObjectItem(it, "files")) {
      cJSON *fo = cJSON_CreateObject();
      cJSON_AddNumberToObject(fo, "id", num(f, "id"));
      const char *nm = str(f, "name");
      const char *sn = str(f, "short_name");
      cJSON_AddStringToObject(fo, "name", *nm ? nm : sn);
      cJSON_AddStringToObject(fo, "short_name", *sn ? sn : path_basename(nm));
      cJSON_AddNumberToObject(fo, "size", num(f, "size"));
      cJSON_AddItemToArray(files, fo);
    }
    cJSON_AddItemToArray(out, o);
  }
  if (single) cJSON_Delete(single);
  cJSON_Delete(j);
  return out;
}

char *torbox_requestdl(const char *kind, int64_t item_id, int64_t file_id, char **err) {
  char *key = config_api_key();
  char *ek = url_encode(key);
  const char *idp = !strcmp(kind, "torrents") ? "torrent_id" : !strcmp(kind, "usenet") ? "usenet_id" : "web_id";
  char *q = str_printf("token=%s&%s=%lld&file_id=%lld&zip_link=false", ek, idp,
                       (long long)item_id, (long long)file_id);
  char *path = str_printf("%s/requestdl", kind);
  cJSON *j = call("GET", path, q, NULL, NULL, err);
  free(path); free(q); free(ek); free(key);
  if (!j) return NULL;
  cJSON *d = cJSON_GetObjectItem(j, "data");
  char *url = (cJSON_IsString(d) && !strncmp(d->valuestring, "http", 4)) ? xstrdup(d->valuestring) : NULL;
  if (!url) *err = xstrdup("TorBox não gerou o link de download");
  cJSON_Delete(j);
  return url;
}

cJSON *torbox_add(const char *link, char **err) {
  while (*link == ' ' || *link == '\n' || *link == '\t') link++;
  cJSON *j = NULL;
  const char *kind;
  const char *idkey;
  if (!strncasecmp(link, "magnet:", 7)) {
    const char *kv[] = { "magnet", link, "seed", "3", "allow_zip", "false", NULL };
    kind = "torrents"; idkey = "torrent_id";
    j = call("POST", "torrents/createtorrent", NULL, NULL, kv, err);
  } else if (strstr(link, ".nzb")) {
    const char *kv[] = { "link", link, NULL };
    kind = "usenet"; idkey = "usenetdownload_id";
    j = call("POST", "usenet/createusenetdownload", NULL, NULL, kv, err);
  } else if (!strncasecmp(link, "http://", 7) || !strncasecmp(link, "https://", 8)) {
    const char *kv[] = { "link", link, NULL };
    kind = "webdl"; idkey = "webdownload_id";
    j = call("POST", "webdl/createwebdownload", NULL, NULL, kv, err);
  } else {
    *err = xstrdup("Link não reconhecido (use magnet:, http:// ou https://)");
    return NULL;
  }
  if (!j) return NULL;
  cJSON *res = cJSON_CreateObject();
  cJSON_AddStringToObject(res, "kind", kind);
  cJSON *d = cJSON_GetObjectItem(j, "data");
  cJSON_AddNumberToObject(res, "id", num(d, idkey));
  const char *detail = str(j, "detail");
  cJSON_AddStringToObject(res, "detail", detail);
  cJSON_AddBoolToObject(res, "cached", strcasestr(detail, "cached") && !strcasestr(detail, "not cached"));
  cJSON_Delete(j);
  return res;
}

int torbox_delete(const char *kind, int64_t id, char **err) {
  cJSON *b = cJSON_CreateObject();
  const char *path;
  if (!strcmp(kind, "torrents")) { cJSON_AddNumberToObject(b, "torrent_id", (double)id); path = "torrents/controltorrent"; }
  else if (!strcmp(kind, "usenet")) { cJSON_AddNumberToObject(b, "usenet_id", (double)id); path = "usenet/controlusenetdownload"; }
  else { cJSON_AddNumberToObject(b, "webdl_id", (double)id); path = "webdl/controlwebdownload"; }
  cJSON_AddStringToObject(b, "operation", "delete");
  cJSON *j = call("POST", path, NULL, b, NULL, err);
  cJSON_Delete(b);
  if (!j) return -1;
  cJSON_Delete(j);
  return 0;
}

cJSON *torbox_me(char **err) {
  cJSON *j = call("GET", "user/me", NULL, NULL, NULL, err);
  if (!j) return NULL;
  cJSON *d = cJSON_GetObjectItem(j, "data");
  cJSON *o = cJSON_CreateObject();
  cJSON_AddStringToObject(o, "email", str(d, "email"));
  int plan = (int)num(d, "plan");
  const char *pn = plan == 0 ? "Free" : plan == 1 ? "Essential" : plan == 2 ? "Pro" : plan == 3 ? "Standard" : "?";
  cJSON_AddStringToObject(o, "plan", pn);
  cJSON_AddStringToObject(o, "expires", str(d, "premium_expires_at"));
  cJSON_Delete(j);
  return o;
}

/* ---------- login por código de dispositivo (QR code) ---------- */
static pthread_mutex_t auth_lk = PTHREAD_MUTEX_INITIALIZER;
static struct {
  char *state;        /* idle pending ok expired error */
  char *device_code, *code, *url, *friendly, *error;
  double expires;
  int interval;
  int generation;
} auth = { 0 };

static cJSON *noauth_req(const char *method, const char *path, const char *json_body, char **err) {
  CURL *c = curl_easy_init();
  http_resp_t r = {0};
  char *url = str_printf("%s/%s", torbox_base(), path);
  struct curl_slist *h = curl_slist_append(NULL, "Accept: application/json");
  http_setup_common(c);
  curl_easy_setopt(c, CURLOPT_URL, url);
  curl_easy_setopt(c, CURLOPT_TIMEOUT, 30L);
  curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, sink);
  curl_easy_setopt(c, CURLOPT_WRITEDATA, &r);
  if (!strcmp(method, "POST")) {
    h = curl_slist_append(h, "Content-Type: application/json");
    curl_easy_setopt(c, CURLOPT_POSTFIELDS, json_body ? json_body : "{}");
  }
  curl_easy_setopt(c, CURLOPT_HTTPHEADER, h);
  CURLcode rc = curl_easy_perform(c);
  curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &r.status);
  cJSON *j = NULL;
  if (rc != CURLE_OK) *err = str_printf("Sem conexão com o TorBox: %s", curl_easy_strerror(rc));
  else if (!(j = r.data ? cJSON_Parse(r.data) : NULL)) *err = str_printf("Resposta inválida do TorBox (HTTP %ld)", r.status);
  curl_slist_free_all(h);
  curl_easy_cleanup(c);
  free(url); free(r.data);
  return j;
}

static void auth_set(const char *st, const char *err) {
  free(auth.state); auth.state = xstrdup(st);
  free(auth.error); auth.error = xstrdup(err ? err : "");
}

static void *auth_poll(void *arg) {
  int gen = (int)(intptr_t)arg;
  for (;;) {
    pthread_mutex_lock(&auth_lk);
    if (gen != auth.generation || strcmp(auth.state, "pending")) { pthread_mutex_unlock(&auth_lk); return NULL; }
    if (now_sec() > auth.expires) { auth_set("expired", "O código expirou. Gere outro."); pthread_mutex_unlock(&auth_lk); return NULL; }
    int iv = auth.interval > 0 ? auth.interval : 5;
    char *body = str_printf("{\"device_code\":\"%s\"}", auth.device_code);
    pthread_mutex_unlock(&auth_lk);
    for (int i = 0; i < iv * 10 && !g_stop; i++) msleep(100);
    if (g_stop) { free(body); return NULL; }
    char *err = NULL;
    cJSON *j = noauth_req("POST", "user/auth/device/token", body, &err);
    free(body);
    if (!j) { LOG("auth: %s", err); free(err); continue; }      /* falha de rede: tenta de novo */
    cJSON *d = cJSON_GetObjectItem(j, "data");
    cJSON *tok = cJSON_GetObjectItem(d, "access_token");
    if (cJSON_IsTrue(cJSON_GetObjectItem(j, "success")) && cJSON_IsString(tok) && *tok->valuestring) {
      cJSON *c = cJSON_CreateObject();
      cJSON_AddStringToObject(c, "api_key", tok->valuestring);
      config_update(c);
      cJSON_Delete(c);
      pthread_mutex_lock(&auth_lk);
      if (gen == auth.generation) auth_set("ok", NULL);
      pthread_mutex_unlock(&auth_lk);
      LOG("TorBox conectado por código de dispositivo");
      platform_notify("TorBox conectado!");
      cJSON_Delete(j);
      return NULL;
    }
    const char *e = str(j, "error");
    if (*e && strcasestr(e, "expire")) {
      pthread_mutex_lock(&auth_lk);
      if (gen == auth.generation) auth_set("expired", "O código expirou. Gere outro.");
      pthread_mutex_unlock(&auth_lk);
      cJSON_Delete(j);
      return NULL;
    }
    cJSON_Delete(j);   /* ainda pendente */
  }
}

cJSON *torbox_auth_start(char **err) {
  cJSON *j = noauth_req("GET", "user/auth/device/start?app=Nimbo%20PS5", NULL, err);
  if (!j) return NULL;
  cJSON *d = cJSON_GetObjectItem(j, "data");
  const char *dc = str(d, "device_code");
  if (!cJSON_IsTrue(cJSON_GetObjectItem(j, "success")) || !*dc) {
    const char *det = str(j, "detail");
    *err = xstrdup(*det ? det : "O TorBox não iniciou o login");
    cJSON_Delete(j);
    return NULL;
  }
  pthread_mutex_lock(&auth_lk);
  free(auth.device_code); auth.device_code = xstrdup(dc);
  free(auth.code); auth.code = xstrdup(str(d, "code"));
  const char *vu = str(d, "verification_url");
  free(auth.url); auth.url = xstrdup(*vu ? vu : "https://torbox.app/oauth/device");
  const char *fu = str(d, "friendly_verification_url");
  free(auth.friendly); auth.friendly = xstrdup(*fu ? fu : auth.url);
  double iv = num(d, "interval");
  auth.interval = iv > 0 ? (int)iv : 5;
  double ein = num(d, "expires_in");
  auth.expires = now_sec() + (ein > 0 ? ein : 600);
  auth_set("pending", NULL);
  int gen = ++auth.generation;
  pthread_mutex_unlock(&auth_lk);
  cJSON_Delete(j);
  pthread_t t;
  pthread_create(&t, NULL, auth_poll, (void *)(intptr_t)gen);
  pthread_detach(t);
  return torbox_auth_status();
}

cJSON *torbox_auth_status(void) {
  pthread_mutex_lock(&auth_lk);
  cJSON *o = cJSON_CreateObject();
  cJSON_AddStringToObject(o, "state", auth.state ? auth.state : "idle");
  cJSON_AddStringToObject(o, "code", auth.code ? auth.code : "");
  cJSON_AddStringToObject(o, "url", auth.url ? auth.url : "");
  cJSON_AddStringToObject(o, "friendly_url", auth.friendly ? auth.friendly : "");
  cJSON_AddStringToObject(o, "error", auth.error ? auth.error : "");
  int left = (int)(auth.expires - now_sec());
  cJSON_AddNumberToObject(o, "expires_in", left > 0 ? left : 0);
  pthread_mutex_unlock(&auth_lk);
  return o;
}

void torbox_auth_cancel(void) {
  pthread_mutex_lock(&auth_lk);
  auth.generation++;
  auth_set("idle", NULL);
  pthread_mutex_unlock(&auth_lk);
}
