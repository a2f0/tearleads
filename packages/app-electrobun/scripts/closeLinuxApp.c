// Test-only X11 close request. Match server-reported client PIDs to the smoke
// launcher's process group; window titles and client-supplied PID properties
// cannot safely distinguish the test app from another desktop window.
#define _POSIX_C_SOURCE 200809L
#include <X11/Xlib.h>
#include <X11/extensions/XRes.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

// A window can disappear between tree enumeration and a property query.
static int ignore_gone_window(Display *display, XErrorEvent *event) {
  (void)display;
  (void)event;
  return 0;
}

static int close_windows(Display *display, Window window, pid_t group, int depth) {
  if (depth > 64) return 0;
  XResClientIdSpec spec = {window, XRES_CLIENT_ID_PID_MASK};
  XResClientIdValue *ids = NULL;
  long count = 0;
  pid_t owner = -1;
  if (XResQueryClientIds(display, 1, &spec, &count, &ids) == Success) {
    for (long i = 0; i < count; i++) {
      pid_t candidate = XResGetClientPid(&ids[i]);
      if (candidate > 0) owner = candidate;
    }
    XResClientIdsDestroy(count, ids);
  }
  Atom close_atom = XInternAtom(display, "WM_DELETE_WINDOW", False);
  Atom *protocols = NULL;
  int protocol_count = 0;
  if (owner > 0 && getpgid(owner) == group &&
      XGetWMProtocols(display, window, &protocols, &protocol_count)) {
    int supports_close = 0;
    for (int i = 0; i < protocol_count; i++) {
      if (protocols[i] == close_atom) supports_close = 1;
    }
    XFree(protocols);
    if (supports_close) {
      XEvent event = {0};
      event.xclient.type = ClientMessage;
      event.xclient.window = window;
      event.xclient.message_type = XInternAtom(display, "WM_PROTOCOLS", False);
      event.xclient.format = 32;
      event.xclient.data.l[0] = (long)close_atom;
      event.xclient.data.l[1] = CurrentTime;
      return XSendEvent(display, window, False, NoEventMask, &event) != 0;
    }
  }
  Window root, parent, *children = NULL;
  unsigned int child_count = 0;
  int closed = 0;
  if (XQueryTree(display, window, &root, &parent, &children, &child_count)) {
    for (unsigned int i = 0; i < child_count; i++) {
      closed += close_windows(display, children[i], group, depth + 1);
    }
    if (children) XFree(children);
  }
  return closed;
}

int main(int argc, char **argv) {
  char *end = NULL;
  long group = argc == 2 ? strtol(argv[1], &end, 10) : 0;
  if (group <= 1 || group > INT_MAX || !end || *end) return 1;
  Display *display = XOpenDisplay(NULL);
  if (!display) return 1;
  XSetErrorHandler(ignore_gone_window);
  int closed = close_windows(display, DefaultRootWindow(display), (pid_t)group, 0);
  XSync(display, False);
  XCloseDisplay(display);
  fprintf(stderr, "Requested native close for %d application window(s).\n", closed);
  return closed > 0 ? 0 : 1;
}
