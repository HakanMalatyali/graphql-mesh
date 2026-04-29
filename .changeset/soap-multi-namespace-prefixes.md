---
"@omnigraph/soap": patch
---

fix(soap): correct namespace prefix resolution for multi-namespace WSDLs

SOAP requests generated for WSDLs that mix types from multiple XSD namespaces were using a single
namespace prefix for all body elements, causing upstream services to reject the request.

- Resolves `bindingNamespace` from the element's XSD type namespace (not the binding tns)
- Propagates all WSDL `xmlns` declarations via `namespaceMap` on the `@soap` directive
- Adds per-field namespace prefix resolution in the executor via `buildNamespacedValue`
- Adds `@soapType` directive to InputObjectTypes to carry XSD namespace metadata
- Adds `NamespaceEntry` input type used by `namespaceMap`

Backwards compatible: schemas generated before this change fall back to the previous
single-prefix behaviour when `namespaceMap` is absent on the `@soap` directive.
