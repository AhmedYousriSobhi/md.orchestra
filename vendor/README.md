# vendor/

Third-party browser libraries, committed so the app never needs the network to
render Markdown (SPEC: local-first). Same versions that `index.html` previously
loaded from cdnjs.cloudflare.com, downloaded from there unchanged.

| File | Library | Version | SHA-256 |
|---|---|---|---|
| highlight.min.js | highlight.js | 11.9.0 | 837a6fa5b0c736b52bbde2b2b6190f305da3fc9ed41681db5321507057b5c846 |
| atom-one-dark.min.css | highlight.js theme | 11.9.0 | 4237ffca7ce6aadb438c457e0a675b125c534bbdda5b87f41f3a1495603bcc9b |
| markdown-it.min.js | markdown-it | 13.0.2 | 819df17b405d089a653621d64caae6e80199c9d3f2df88c9299a8521ffbb848c |
| purify.min.js | DOMPurify | 3.1.6 | c0845096a7c4a6741f362ac506c94c1c7d27dc603bcc1bf64a587f76f2dbe3a1 |
| mermaid.min.js | mermaid | 10.9.1 | 61b335a46df05a7ce1c98378f60e5f3e77a7fb608a1056997e8a649304a936d6 |

Licenses: highlight.js BSD-3-Clause, markdown-it MIT, DOMPurify Apache-2.0/MPL-2.0,
mermaid MIT. To upgrade, replace the file, update the version and hash here, and
run the full test suite.
