---
"@omnigraph/soap": patch
---

`bindingNamespace` in the `@soap` directive is now resolved from the XSD element's own
target namespace rather than the WSDL `targetNamespace`. This prevents the executor from
using the wrong XML namespace prefix (e.g. `tns:`) when the actual element type lives in
a separate schema namespace (e.g. `ns2:`).

The `soapHeaders` namespace and alias are also computed before the `@soap` directive is
written to the schema, ensuring the correct values are captured at generation time.
