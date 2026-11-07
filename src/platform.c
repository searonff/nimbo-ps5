/* Funções específicas do PS5 (com equivalentes vazios no Linux). */
#include "nimbo.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>

volatile bool g_stop;

#ifdef __PROSPERO__
typedef struct notify_request { char useless1[45]; char message[3075]; } notify_request_t;
int sceKernelSendNotificationRequest(int, notify_request_t *, size_t, int);
int sceUserServiceInitialize(void *);
int sceSystemServiceLaunchWebBrowser(const char *uri, void *);
int sceSystemServicePowerTick(void);
int sceAppInstUtilInitialize(void);
int sceAppInstUtilAppInstallAll(void *);
#include <ps5/kernel.h>
#include <errno.h>
#include <sys/stat.h>
extern const unsigned char g_icon0[];
extern const size_t g_icon0_len;
#endif

#define TILE_ID "NIMB00001"

void platform_init(void) {
#ifdef __PROSPERO__
  sceUserServiceInitialize(0);
#endif
}

void platform_notify(const char *fmt, ...) {
  char msg[512];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(msg, sizeof msg, fmt, ap);
  va_end(ap);
#ifdef __PROSPERO__
  notify_request_t req;
  memset(&req, 0, sizeof req);
  snprintf(req.message, sizeof req.message, "Nimbo: %s", msg);
  sceKernelSendNotificationRequest(0, &req, sizeof req, 0);
#endif
  LOG("[notificação] %s", msg);
}

void platform_open_browser(int port) {
#ifdef __PROSPERO__
  char url[64];
  snprintf(url, sizeof url, "http://127.0.0.1:%d/", port);
  if (sceSystemServiceLaunchWebBrowser(url, 0)) LOG("não foi possível abrir o navegador");
#else
  LOG("abra http://127.0.0.1:%d/ no navegador", port);
#endif
}

void platform_power_tick(void) {
#ifdef __PROSPERO__
  sceSystemServicePowerTick();
#endif
}

char *platform_local_ip(void) {
  int s = socket(AF_INET, SOCK_DGRAM, 0);
  if (s < 0) return xstrdup("");
  struct sockaddr_in a = { .sin_family = AF_INET, .sin_port = htons(53) };
  inet_pton(AF_INET, "8.8.8.8", &a.sin_addr);
  char buf[INET_ADDRSTRLEN] = "";
  if (connect(s, (struct sockaddr *)&a, sizeof a) == 0) {
    struct sockaddr_in me;
    socklen_t l = sizeof me;
    if (getsockname(s, (struct sockaddr *)&me, &l) == 0) inet_ntop(AF_INET, &me.sin_addr, buf, sizeof buf);
  }
  close(s);
  return xstrdup(buf);
}

/* Atalho na tela inicial: /user/app/NIMB00001 com param.json (deeplink para a
 * interface) + icon0.png, registrado pelo SceAppInstUtil — mesmo método do
 * Homebrew Launcher do websrv. media=true => aba Mídia. */
int platform_install_tile(bool media, bool force, int port) {
#ifdef __PROSPERO__
  struct stat st;
  if (!force && !stat("/user/appmeta/" TILE_ID "/param.json", &st)) return 0;
  uint64_t old = kernel_get_ucred_authid(-1);
  kernel_set_ucred_authid(-1, 0x4801000000000013L);
  int r = -1;
  if (sceAppInstUtilInitialize() == 0) {
    mkdir("/user/app/" TILE_ID, 0755);
    mkdir("/user/app/" TILE_ID "/sce_sys", 0755);
    char *param = str_printf(
      "{\n"
      "  \"titleId\": \"" TILE_ID "\",\n"
      "  \"applicationCategoryType\": %d,\n"
      "  \"deeplinkUri\": \"http://127.0.0.1:%d/\",\n"
      "  \"localizedParameters\": {\n"
      "    \"defaultLanguage\": \"en-US\",\n"
      "    \"en-US\": { \"titleName\": \"Nimbo PS5\" },\n"
      "    \"pt-BR\": { \"titleName\": \"Nimbo PS5\" }\n"
      "  }\n"
      "}\n", media ? 65536 : 0, port);
    int ok = write_file_atomic("/user/app/" TILE_ID "/sce_sys/param.json", param, strlen(param)) == 0 &&
             write_file_atomic("/user/app/" TILE_ID "/sce_sys/icon0.png", (const char *)g_icon0, g_icon0_len) == 0;
    free(param);
    if (ok) {
      int (*install_dir)(const char *, const char *, void *) = 0;
      uint32_t h;
      if (!kernel_dynlib_handle(-1, "libSceAppInstUtil.sprx", &h))
        install_dir = (void *)kernel_dynlib_resolve(-1, h, "Wudg3Xe3heE");
      r = install_dir ? install_dir(TILE_ID, "/user/app/", 0) : sceAppInstUtilAppInstallAll(0);
      LOG("atalho na tela inicial: %s (0x%x)", r == 0 ? "instalado" : "falhou", r);
    }
  }
  kernel_set_ucred_authid(-1, old);
  return r;
#else
  (void)force;
  LOG("(PC) atalho %s ignorado na porta %d", media ? "Mídia" : "Jogos", port);
  return 0;
#endif
}
