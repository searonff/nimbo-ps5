/* Servidor HTTP/1.1 mínimo: uma thread por conexão, Connection: close. */
#include "nimbo.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>
#include <signal.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <sys/time.h>

#define MAX_HEADER (32 * 1024)
#define MAX_BODY (4 * 1024 * 1024)

static const char *status_text(int s) {
  switch (s) {
    case 200: return "OK"; case 206: return "Partial Content"; case 204: return "No Content";
    case 400: return "Bad Request"; case 403: return "Forbidden"; case 404: return "Not Found";
    case 405: return "Method Not Allowed"; case 413: return "Payload Too Large";
    case 416: return "Range Not Satisfiable"; default: return "Error";
  }
}

static int send_all(int fd, const void *b, size_t n) {
  const char *p = b;
  while (n) {
    ssize_t w = send(fd, p, n, 0);
    if (w < 0) { if (errno == EINTR) continue; return -1; }
    p += w; n -= w;
  }
  return 0;
}

char *query_get(const char *query, const char *key) {
  if (!query) return NULL;
  size_t kl = strlen(key);
  const char *p = query;
  while (*p) {
    const char *amp = strchr(p, '&');
    size_t len = amp ? (size_t)(amp - p) : strlen(p);
    if (len > kl && !strncmp(p, key, kl) && p[kl] == '=') {
      char *v = strndup(p + kl + 1, len - kl - 1);
      url_decode_inplace(v);
      return v;
    }
    if (!amp) break;
    p = amp + 1;
  }
  return NULL;
}

static void *conn_thread(void *arg) {
  int fd = (int)(intptr_t)arg;
  struct timeval tv = { 30, 0 };
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
  int one = 1;
  setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);

  char *buf = malloc(MAX_HEADER + 1);
  size_t got = 0;
  char *hend = NULL;
  while (got < MAX_HEADER) {
    ssize_t r = recv(fd, buf + got, MAX_HEADER - got, 0);
    if (r <= 0) break;
    got += r;
    buf[got] = 0;
    if ((hend = strstr(buf, "\r\n\r\n"))) break;
  }
  req_t rq = {0};
  resp_t rs = { .status = 200, .content_type = "application/json; charset=utf-8", .file_fd = -1 };
  if (!hend) goto done;
  *hend = 0;
  size_t header_len = (hend - buf) + 4;

  /* linha de requisição */
  char *sp1 = strchr(buf, ' ');
  if (!sp1) goto done;
  *sp1 = 0;
  snprintf(rq.method, sizeof rq.method, "%s", buf);
  char *target = sp1 + 1;
  char *sp2 = strchr(target, ' ');
  if (!sp2) goto done;
  *sp2 = 0;
  char *q = strchr(target, '?');
  if (q) { *q = 0; rq.query = xstrdup(q + 1); }
  rq.path = xstrdup(target);
  url_decode_inplace(rq.path);

  size_t clen = 0;
  for (char *line = strstr(sp2 + 1, "\r\n"); line; line = strstr(line, "\r\n")) {
    line += 2;
    if (!strncasecmp(line, "Content-Length:", 15)) clen = strtoul(line + 15, NULL, 10);
    else if (!strncasecmp(line, "Range:", 6)) {
      char *v = line + 6; while (*v == ' ') v++;
      char *e = strstr(v, "\r\n");
      rq.range = e ? strndup(v, e - v) : xstrdup(v);
    }
  }
  if (clen > MAX_BODY) { rs.status = 413; rs.body = xstrdup("{\"error\":\"corpo grande demais\"}"); goto respond; }
  rq.body = malloc(clen + 1);
  size_t have = got - header_len;
  if (have > clen) have = clen;
  memcpy(rq.body, buf + header_len, have);
  while (have < clen) {
    ssize_t r = recv(fd, rq.body + have, clen - have, 0);
    if (r <= 0) break;
    have += r;
  }
  rq.body[have] = 0;
  rq.body_len = have;

  api_handle(&rq, &rs);

respond: ;
  size_t blen = rs.body ? (rs.body_len ? rs.body_len : strlen(rs.body)) : rs.static_body ? rs.body_len : 0;
  int64_t clen_out = rs.file_fd >= 0 ? rs.file_len : (int64_t)blen;
  char *hdr = str_printf("HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %lld\r\n"
                         "Connection: close\r\nCache-Control: no-store\r\n"
                         "Access-Control-Allow-Origin: *\r\n%s\r\n",
                         rs.status, status_text(rs.status), rs.content_type, (long long)clen_out,
                         rs.extra_headers ? rs.extra_headers : "");
  if (send_all(fd, hdr, strlen(hdr)) == 0 && strcmp(rq.method, "HEAD")) {
    if (rs.file_fd >= 0) {
      char *fb = malloc(1 << 20);
      int64_t left = rs.file_len, off = rs.file_off;
      while (left > 0) {
        ssize_t r = pread(rs.file_fd, fb, left > (1 << 20) ? (1 << 20) : (size_t)left, off);
        if (r <= 0 || send_all(fd, fb, r)) break;
        left -= r; off += r;
      }
      free(fb);
    } else if (blen) {
      send_all(fd, rs.body ? rs.body : rs.static_body, blen);
    }
  }
  free(hdr);

done:
  if (rs.file_fd >= 0) close(rs.file_fd);
  free(rs.body); free(rs.extra_headers);
  free(rq.path); free(rq.query); free(rq.body); free(rq.range);
  free(buf);
  shutdown(fd, SHUT_WR);
  close(fd);
  return NULL;
}

int server_listen(int port) {
  signal(SIGPIPE, SIG_IGN);
  int s = socket(AF_INET, SOCK_STREAM, 0);
  if (s < 0) return -1;
  int one = 1;
  setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  struct sockaddr_in a = { .sin_family = AF_INET, .sin_port = htons(port), .sin_addr.s_addr = htonl(INADDR_ANY) };
  if (bind(s, (struct sockaddr *)&a, sizeof a) || listen(s, 64)) {
    close(s);
    return -2;   /* porta ocupada: provavelmente já está rodando */
  }
  LOG("servidor em http://0.0.0.0:%d/", port);
  return s;
}

void *server_loop(void *arg) {
  int s = (int)(intptr_t)arg;
  struct timeval tv = { 1, 0 };
  setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
  while (!g_stop) {
    int c = accept(s, NULL, NULL);
    if (c < 0) continue;
    pthread_t th;
    pthread_attr_t at;
    pthread_attr_init(&at);
    pthread_attr_setdetachstate(&at, PTHREAD_CREATE_DETACHED);
    pthread_attr_setstacksize(&at, 512 * 1024);
    if (pthread_create(&th, &at, conn_thread, (void *)(intptr_t)c)) close(c);
    pthread_attr_destroy(&at);
  }
  close(s);
  return NULL;
}
