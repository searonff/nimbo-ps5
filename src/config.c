#include "nimbo.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

config_t g_cfg;
pthread_mutex_t g_cfg_lock = PTHREAD_MUTEX_INITIALIZER;
char *g_data_dir;

static char *cfg_path(void) { return path_join(g_data_dir, "config.json"); }

static void set_str(char **dst, const char *v) { free(*dst); *dst = xstrdup(v ? v : ""); }

static int clampi(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

static void apply(cJSON *j) {
  cJSON *v;
  if ((v = cJSON_GetObjectItem(j, "api_key")) && cJSON_IsString(v)) {
    /* a UI manda "" quando não quer trocar a chave mascarada */
    if (strncmp(v->valuestring, "••", 2) != 0) set_str(&g_cfg.api_key, v->valuestring);
  }
  if ((v = cJSON_GetObjectItem(j, "default_dest")) && cJSON_IsString(v) && *v->valuestring)
    set_str(&g_cfg.default_dest, v->valuestring);
  if ((v = cJSON_GetObjectItem(j, "passwords")) && cJSON_IsArray(v)) {
    cJSON *arr = cJSON_CreateArray();
    cJSON *it;
    cJSON_ArrayForEach(it, v) {
      if (cJSON_IsString(it) && *it->valuestring) cJSON_AddItemToArray(arr, cJSON_CreateString(it->valuestring));
    }
    cJSON_Delete(g_cfg.passwords);
    g_cfg.passwords = arr;
  }
#define BOOLF(name) if ((v = cJSON_GetObjectItem(j, #name)) && cJSON_IsBool(v)) g_cfg.name = cJSON_IsTrue(v);
  BOOLF(auto_extract) BOOLF(delete_after_extract) BOOLF(extract_to_subfolder)
  BOOLF(delete_from_cloud) BOOLF(prevent_sleep) BOOLF(speed_limit_on) BOOLF(open_browser)
#undef BOOLF
  if ((v = cJSON_GetObjectItem(j, "speed_limit_kbps")) && cJSON_IsNumber(v)) g_cfg.speed_limit_kbps = clampi(v->valueint, 64, 1000000);
  if ((v = cJSON_GetObjectItem(j, "max_parallel")) && cJSON_IsNumber(v)) g_cfg.max_parallel = clampi(v->valueint, 1, 5);
  if ((v = cJSON_GetObjectItem(j, "connections")) && cJSON_IsNumber(v)) g_cfg.connections = clampi(v->valueint, 1, 8);
  if ((v = cJSON_GetObjectItem(j, "port")) && cJSON_IsNumber(v)) g_cfg.port = clampi(v->valueint, 1024, 65535);
}

void config_load(void) {
  pthread_mutex_lock(&g_cfg_lock);
  memset(&g_cfg, 0, sizeof g_cfg);
  g_cfg.api_key = xstrdup("");
#ifdef __PROSPERO__
  g_cfg.default_dest = xstrdup("/data/Nimbo");
#else
  const char *d = getenv("NIMBO_DEFAULT_DEST");
  g_cfg.default_dest = xstrdup(d ? d : "/tmp/Nimbo");
#endif
  g_cfg.passwords = cJSON_CreateArray();
  g_cfg.auto_extract = true;
  g_cfg.delete_after_extract = false;
  g_cfg.extract_to_subfolder = true;
  g_cfg.delete_from_cloud = false;
  g_cfg.prevent_sleep = true;
  g_cfg.open_browser = true;
  g_cfg.speed_limit_on = false;
  g_cfg.speed_limit_kbps = 5000;
  g_cfg.max_parallel = 2;
  g_cfg.connections = 4;
  g_cfg.port = NIMBO_DEFAULT_PORT;

  char *p = cfg_path();
  char *txt = read_file(p, NULL);
  if (txt) {
    cJSON *j = cJSON_Parse(txt);
    if (j) { apply(j); cJSON_Delete(j); }
    else LOG("config.json inválido, usando padrões");
    free(txt);
  }
  free(p);
  const char *envkey = getenv("NIMBO_API_KEY");
  if (envkey && !*g_cfg.api_key) set_str(&g_cfg.api_key, envkey);
  pthread_mutex_unlock(&g_cfg_lock);
}

static cJSON *to_json_locked(bool hide_key) {
  cJSON *j = cJSON_CreateObject();
  if (hide_key) {
    size_t n = strlen(g_cfg.api_key);
    char *m = n ? str_printf("••••••%s", n > 4 ? g_cfg.api_key + n - 4 : "") : xstrdup("");
    cJSON_AddStringToObject(j, "api_key", m);
    free(m);
    cJSON_AddBoolToObject(j, "has_key", n > 0);
  } else {
    cJSON_AddStringToObject(j, "api_key", g_cfg.api_key);
  }
  cJSON_AddStringToObject(j, "default_dest", g_cfg.default_dest);
  cJSON_AddItemToObject(j, "passwords", cJSON_Duplicate(g_cfg.passwords, 1));
  cJSON_AddBoolToObject(j, "auto_extract", g_cfg.auto_extract);
  cJSON_AddBoolToObject(j, "delete_after_extract", g_cfg.delete_after_extract);
  cJSON_AddBoolToObject(j, "extract_to_subfolder", g_cfg.extract_to_subfolder);
  cJSON_AddBoolToObject(j, "delete_from_cloud", g_cfg.delete_from_cloud);
  cJSON_AddBoolToObject(j, "prevent_sleep", g_cfg.prevent_sleep);
  cJSON_AddBoolToObject(j, "open_browser", g_cfg.open_browser);
  cJSON_AddBoolToObject(j, "speed_limit_on", g_cfg.speed_limit_on);
  cJSON_AddNumberToObject(j, "speed_limit_kbps", g_cfg.speed_limit_kbps);
  cJSON_AddNumberToObject(j, "max_parallel", g_cfg.max_parallel);
  cJSON_AddNumberToObject(j, "connections", g_cfg.connections);
  cJSON_AddNumberToObject(j, "port", g_cfg.port);
  return j;
}

cJSON *config_to_json(bool hide_key) {
  pthread_mutex_lock(&g_cfg_lock);
  cJSON *j = to_json_locked(hide_key);
  pthread_mutex_unlock(&g_cfg_lock);
  return j;
}

void config_save(void) {
  pthread_mutex_lock(&g_cfg_lock);
  cJSON *j = to_json_locked(false);
  pthread_mutex_unlock(&g_cfg_lock);
  char *txt = cJSON_Print(j);
  char *p = cfg_path();
  mkdirs(g_data_dir);
  if (write_file_atomic(p, txt, strlen(txt))) LOG("falha ao salvar %s", p);
  free(p);
  free(txt);
  cJSON_Delete(j);
}

void config_update(cJSON *j) {
  pthread_mutex_lock(&g_cfg_lock);
  apply(j);
  pthread_mutex_unlock(&g_cfg_lock);
  config_save();
}

char *config_api_key(void) {
  pthread_mutex_lock(&g_cfg_lock);
  char *k = xstrdup(g_cfg.api_key);
  pthread_mutex_unlock(&g_cfg_lock);
  return k;
}

char **config_passwords(int *n) {
  pthread_mutex_lock(&g_cfg_lock);
  int c = cJSON_GetArraySize(g_cfg.passwords);
  char **v = calloc(c + 1, sizeof(char *));
  for (int i = 0; i < c; i++) v[i] = xstrdup(cJSON_GetArrayItem(g_cfg.passwords, i)->valuestring);
  pthread_mutex_unlock(&g_cfg_lock);
  *n = c;
  return v;
}

void free_strv(char **v, int n) {
  if (!v) return;
  for (int i = 0; i < n; i++) free(v[i]);
  free(v);
}

int64_t config_speed_limit_bps(void) {
  pthread_mutex_lock(&g_cfg_lock);
  int64_t r = g_cfg.speed_limit_on ? (int64_t)g_cfg.speed_limit_kbps * 1024 : 0;
  pthread_mutex_unlock(&g_cfg_lock);
  return r;
}
