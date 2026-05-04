---
"@graphql-mesh/transport-soap": minor
---

Add per-field namespace prefix resolution for multi-namespace WSDL services:

- The executor now reads the `namespaceMap` from the `@soap` directive and determines the correct XML namespace alias (`bindingAlias`) for the binding namespace, so body elements are serialised with the right prefix (e.g. `<ns2:GetData>` instead of `<tns:GetData>`).
- A new `buildNamespacedValue` helper walks the GraphQL input argument tree and assigns the appropriate namespace prefix to each XML element based on the `soapNamespace` extension of the corresponding GraphQL input type, falling back to the `@soapType` directive when extensions are not available after an SDL round-trip.
- All namespace declarations from `namespaceMap` are now declared on the `soap:Envelope` element so every prefix used in the body is in scope.
