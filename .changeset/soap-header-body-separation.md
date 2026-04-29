---
"@omnigraph/soap": patch
---

fix(soap): exclude soap:header parts from the soap:body argument list

SOAP message parts bound to `soap:header` were incorrectly included as
`soap:body` arguments. Parts explicitly listed in `soap:body/@parts` are
now the only ones forwarded as body arguments; all other parts are treated
as headers.

- Adds `SOAPHeaderAttributes` and `SOAPHeader` types
- Adds `parts` attribute to `SOAPBodyAttributes`
- Excludes header-bound parts from body field args in the loader
- Auto-detects `soapHeaders.namespace` from the WSDL binding when not explicitly provided
- Makes `SOAPHeaders.namespace` optional
