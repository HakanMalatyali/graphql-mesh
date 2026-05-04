---
"@omnigraph/soap": patch
---

`soap:header` binding parts are now excluded from the GraphQL field arguments generated
for the `soap:body`. Only parts listed (or implied) in the `soap:body` binding appear as
field arguments, matching the actual SOAP wire format and preventing header-only data
from leaking into the operation input.
