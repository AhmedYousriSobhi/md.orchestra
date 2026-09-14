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

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/index.html >/dev/null || exit 1
