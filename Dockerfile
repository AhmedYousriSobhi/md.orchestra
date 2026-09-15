# The whole app is static files (no build step, no server-side code), so the
# only job here is serving them efficiently and portably. nginx:alpine keeps
# the image small and needs no build stage.
FROM nginx:alpine

COPY . /usr/share/nginx/html

# This app is under active development, redeployed often within the same
# session — every one of these static files needs Cache-Control set
# explicitly, or the browser's own HTTP cache can (and does) satisfy a
# reload straight from disk without a request ever reaching nginx, making a
# real code change look like it "didn't take effect." sw.js's own
# network-first fetch handler forces a real round-trip on its end (see
# sw.js), but that's moot if the browser answers the round-trip from cache
# instead of asking this server — so every path gets the same treatment,
# not just sw.js.
RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    add_header Cache-Control "no-cache, no-store, must-revalidate" always;\n\
\n\
    location / {\n\
        try_files $uri $uri/ =404;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80

# 127.0.0.1, not "localhost": Alpine/musl resolves "localhost" to the IPv6
# loopback (::1) first, and nginx's `listen 80;` above only binds the IPv4
# socket — so `wget http://localhost/...` gets "connection refused" from
# inside this exact container even while the app is served correctly over
# the (IPv4) port mapping, permanently marking it unhealthy.
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/index.html >/dev/null || exit 1
