---
"@omnigraph/soap": minor
---

Improve multi-namespace WSDL support in the SOAP loader:

- `soap:header` binding parts are now excluded from the GraphQL field arguments generated for the `soap:body`, matching the actual SOAP wire format.
- `bindingNamespace` in the `@soap` directive is now resolved from the XSD element's own target namespace rather than the WSDL `targetNamespace`, so the executor uses the correct XML namespace prefix when constructing requests.
- All namespace declarations from the WSDL are propagated through a `namespaceMap` field on the `@soap` directive, giving the executor full alias→URI knowledge for accurate multi-namespace serialisation.
- When `soapHeaders` is configured without an explicit `namespace`, the loader auto-detects the namespace and alias from the WSDL `soap:header` binding, including wrapping headers inside the correct part element name.
