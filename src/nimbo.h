/* Nimbo PS5 — gerenciador de downloads do TorBox para PS5 (payload ELF).
 * Código portátil: compila para PS5 (__PROSPERO__) e para Linux (testes). */
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>
#include <pthread.h>
#include "vendor/cJSON.h"

#define NIMBO_VERSION "1.0.0"
#define NIMBO_DEFAULT_PORT 8090

/* ---------- util.c ---------- */
void  logf_(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
#define LOG(...) logf_(__VA_ARGS__)
char *xstrdup(const char *s);
char *str_printf(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
bool  str_ends_with_ci(const char *s, const char *suffix);
void  sanitize_component(char *s);           /* troca caracteres inválidos (exFAT) por _ */
char *sanitize_relpath(const char *rel);     /* remove "..", "/" inicial, sanitiza */
char *path_join(const char *a, const char *b);
char *path_dirname(const char *p);
const char *path_basename(const char *p);
char *path_unique(const char *path);         /* "x.mkv" -> "x (1).mkv" se existir */
int   mkdirs(const char *path);              /* mkdir -p */
bool  file_exists(const char *path);
bool  is_dir(const char *path);
int64_t file_size(const char *path);
int64_t disk_free(const char *path);
int64_t disk_total(const char *path);
char *read_file(const char *path, size_t *len);
int   write_file_atomic(const char *path, const char *data, size_t len);
int   rm_rf(const char *path);
double now_sec(void);
void  url_decode_inplace(char *s);
char *url_encode(const char *s);
void  msleep(int ms);

/* ---------- config.c ---------- */
typedef struct {
  char *api_key;
  char *default_dest;
  cJSON *passwords;          /* array de strings */
  bool auto_extract;
  bool delete_after_extract;
  bool extract_to_subfolder;
  bool delete_from_cloud;    /* apaga item do TorBox ao terminar de baixar */
  bool prevent_sleep;        /* impede modo de repouso durante downloads */
  bool open_browser;         /* abre o navegador do PS5 ao iniciar */
  bool speed_limit_on;
  int  speed_limit_kbps;     /* KB/s */
  int  max_parallel;         /* downloads simultâneos */
  int  connections;          /* conexões por download */
  int  port;
} config_t;

extern config_t g_cfg;
extern pthread_mutex_t g_cfg_lock;
extern char *g_data_dir;   /* onde ficam config.json e jobs.json */

void   config_load(void);
void   config_save(void);
cJSON *config_to_json(bool hide_key);
void   config_update(cJSON *j);
char  *config_api_key(void);          /* cópia; free() */
char **config_passwords(int *n);      /* cópia; free_strv() */
void   free_strv(char **v, int n);
int64_t config_speed_limit_bps(void); /* 0 = sem limite */

/* ---------- storage.c ---------- */
cJSON *storage_list(void);                 /* unidades disponíveis */
bool   path_allowed(const char *path);     /* dentro de uma unidade permitida */
cJSON *fs_list(const char *path, char **err);
char  *storage_resolve(const char *path, char **err); /* normaliza + valida */

/* ---------- http client / TorBox (torbox.c) ---------- */
typedef struct { char *data; size_t len; long status; } http_resp_t;
void   http_global_init(void);
void   http_setup_common(void *curl);      /* TLS (CA embutido), UA, timeouts */
const char *torbox_base(void);
cJSON *torbox_list(const char *kind, char **err);
char  *torbox_requestdl(const char *kind, int64_t item_id, int64_t file_id, char **err);
cJSON *torbox_add(const char *link, char **err);
int    torbox_delete(const char *kind, int64_t id, char **err);
cJSON *torbox_me(char **err);
cJSON *torbox_auth_start(char **err);   /* login por QR code */
cJSON *torbox_auth_status(void);
void   torbox_auth_cancel(void);

/* ---------- downloads.c ---------- */
void   dl_init(void);
void   dl_shutdown(void);
cJSON *dl_jobs_json(void);
int    dl_add_torbox(const char *kind, int64_t item_id, int64_t file_id,
                     const char *name, int64_t size, const char *dest_dir,
                     bool x_extract, bool x_delete, char **err);
int    dl_add_direct(const char *url, const char *dest_dir, bool x_extract, bool x_delete, char **err);
int    dl_action(int id, const char *action, char **err);
void   dl_clear_finished(void);
bool   dl_path_pending(const char *final_path);   /* arquivo ainda não terminou? */
char **dl_pending_paths(int *n);                 /* free_strv */
int    dl_watch_add(const char *kind, int64_t id, const char *dest, bool xe, bool xd, char **err);
void   dl_watch_remove(const char *kind, int64_t id);
cJSON *dl_watches_json(void);
void   dl_watch_init(void);
int    dl_active_count(void);
int64_t dl_total_speed(void);
void   throttle_consume(size_t bytes);           /* limite de velocidade global */

/* ---------- tasks.c (extração, copiar/mover) ---------- */
typedef enum { ARC_NONE = 0, ARC_FIRST, ARC_PART } arc_kind_t;
arc_kind_t archive_kind(const char *filename);
char **archive_volumes(const char *first, int *n);
char  *archive_first_volume(const char *path);    /* NULL se não for arquivo compactado */
char  *archive_strip_ext(const char *name);

/* ---------- analyze.c (gerenciador de armazenamento) ---------- */
int    analyze_start(const char *path, char **err);
void   analyze_cancel(void);
cJSON *analyze_status(void);
cJSON *analyze_dir(const char *path, char **err);
void   analyze_forget(const char *path, int64_t size);
cJSON *apps_list(void);
char  *apps_icon_path(const char *id);
void   tasks_init(void);
int    tasks_extract(const char *first_volume, bool automatic, bool delete_after, char **err);
int    tasks_copy(const char *src, const char *dst_dir, bool move, char **err);
cJSON *tasks_json(void);
int    tasks_action(int id, const char *action, char **err);
void   tasks_clear_finished(void);
int    tasks_active_count(void);
void   tasks_on_download_done(const char *final_path, bool extract, bool delete_after);

/* ---------- server.c / api.c ---------- */
typedef struct {
  char method[8];
  char *path;      /* sem query, decodificado */
  char *query;     /* bruto */
  char *body;
  size_t body_len;
  char *range;     /* header Range */
} req_t;

typedef struct {
  int status;
  const char *content_type;
  char *body;               /* alocado; free após envio */
  size_t body_len;
  const void *static_body;  /* alternativa sem free */
  char *extra_headers;      /* alocado; terminado em \r\n */
  int file_fd;              /* >=0: envia arquivo */
  int64_t file_off, file_len;
} resp_t;

int   server_listen(int port);           /* fd, ou -2 se a porta estiver ocupada */
void *server_loop(void *fd);
void  api_handle(req_t *rq, resp_t *rs);
char *query_get(const char *query, const char *key);   /* decodificado; free */

/* ---------- assets (gerado) ---------- */
typedef struct { const char *path; const char *mime; const unsigned char *data; size_t len; } asset_t;
extern const asset_t g_assets[];
extern const size_t g_assets_count;
extern const unsigned char g_cacert[];
extern const size_t g_cacert_len;
extern const unsigned char g_icon0[];
extern const size_t g_icon0_len;

/* ---------- platform.c ---------- */
void  platform_init(void);
void  platform_notify(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
void  platform_open_browser(int port);
void  platform_power_tick(void);
int   platform_install_tile(bool media, bool force, int port);
char *platform_local_ip(void);
extern volatile bool g_stop;
