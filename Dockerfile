# The whole app is static files (no build step, no server-side code), so the
# only job here is serving them efficiently and portably. nginx:alpine keeps
# the image small and needs no build stage.
FROM nginx:alpine

COPY . /usr/share/nginx/html

# Service workers only get to control the exact scope they're served from,
# and this app registers sw.js at "/" — make sure nginx doesn't cache it
# aggressively, so an update to the app is picked up on the next reload
# rather than being stuck behind a stale worker.
RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
\n\
    location /sw.js {\n\
        add_header Cache-Control "no-cache";\n\
    }\n\
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
