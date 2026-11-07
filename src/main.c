#include "nimbo.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <unistd.h>
#ifdef __PROSPERO__
#include <sys/syscall.h>
#endif

static void on_term(int s) { (void)s; g_stop = true; }

int main(int argc, char **argv) {
  (void)argc; (void)argv;
#ifdef __PROSPERO__
  syscall(SYS_thr_set_name, -1, "nimbo-ps5.elf");
  g_data_dir = xstrdup("/data/nimbo");
#else
  const char *d = getenv("NIMBO_DATA");
  g_data_dir = xstrdup(d ? d : "./nimbo-data");
#endif
  signal(SIGINT, on_term);
  signal(SIGTERM, on_term);
  signal(SIGPIPE, SIG_IGN);
  mkdirs(g_data_dir);
  platform_init();
  config_load();

  pthread_mutex_lock(&g_cfg_lock);
  int port = g_cfg.port;
  bool open_browser = g_cfg.open_browser;
  pthread_mutex_unlock(&g_cfg_lock);
  const char *envport = getenv("NIMBO_PORT");
  if (envport) port = atoi(envport);

  int fd = server_listen(port);
  if (fd == -2) {            /* já existe um Nimbo rodando: só abre a tela dele */
    LOG("Nimbo já está rodando na porta %d", port);
    platform_open_browser(port);
    return 0;
  }
  if (fd < 0) { platform_notify("Erro ao abrir a porta %d", port); return 1; }

  LOG("Nimbo PS5 %s iniciando (dados em %s)", NIMBO_VERSION, g_data_dir);
  http_global_init();
  dl_init();
  dl_watch_init();
  tasks_init();
  platform_install_tile(true, false, port);

  pthread_t srv;
  pthread_create(&srv, NULL, server_loop, (void *)(intptr_t)fd);

  char *ip = platform_local_ip();
  platform_notify("Rodando! No celular: http://%s:%d", ip, port);
  free(ip);
  if (open_browser) platform_open_browser(port);

  while (!g_stop) msleep(200);
  LOG("encerrando...");
  dl_shutdown();
  config_save();
  pthread_join(srv, NULL);
  return 0;
}
