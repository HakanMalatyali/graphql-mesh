import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'graphql';
import { getDirectiveExtensions } from '@graphql-tools/utils';
import { createExecutorFromSchemaAST, SOAPLoader } from '@omnigraph/soap';
import { fetch, Response } from '@whatwg-node/fetch';
import { dummyLogger as logger } from '../../../testing/dummyLogger';

describe('SOAP multi-namespace', () => {
  it('should use the XSD element namespace prefix in the request body', async () => {
    const soapLoader = new SOAPLoader({
      subgraphName: 'TypesService',
      fetch,
      logger,
    });
    await soapLoader.loadWSDL(
      readFileSync(join(__dirname, './fixtures/cross-namespace.wsdl'), 'utf-8'),
    );
    const schema = soapLoader.buildSchema();

    const fetchSpy = jest.fn(() => Response.error());
    const executor = createExecutorFromSchemaAST(schema, fetchSpy as any);

    await executor({
      document: parse(/* GraphQL */ `
        {
          TypesService_TypesService_TypesServicePort_GetData(GetData: { Id: "123" }) {
            Result
          }
        }
      `),
    });

    const body = fetchSpy.mock.calls[0][1].body as string;

    // Body element must use the XSD type namespace prefix (ns2), not the WSDL tns prefix
    expect(body).toContain('<ns2:GetData>');
    expect(body).not.toContain('<tns:GetData>');

    // Inner fields must also carry the correct prefix
    expect(body).toContain('<ns2:Id>');

    // The envelope must declare the ns2 namespace
    expect(body).toContain('xmlns:ns2="http://example.com/types"');
  });

  it('should propagate namespaceMap from WSDL declarations to the @soap directive', async () => {
    const soapLoader = new SOAPLoader({
      subgraphName: 'TypesService',
      fetch,
      logger,
    });
    await soapLoader.loadWSDL(
      readFileSync(join(__dirname, './fixtures/cross-namespace.wsdl'), 'utf-8'),
    );
    const schema = soapLoader.buildSchema();
    const queryType = schema.getQueryType();
    const field = queryType?.getFields()['TypesService_TypesService_TypesServicePort_GetData'];

    expect(field).toBeDefined();

    // The @soap directive extensions must carry the full namespace map
    const soapDir = getDirectiveExtensions<{
      soap: { namespaceMap: Array<{ alias: string; uri: string }> };
    }>(field!)?.soap?.[0];

    const nsMap = soapDir?.namespaceMap ?? [];
    const tnsEntry = nsMap.find(e => e.alias === 'tns');
    const ns2Entry = nsMap.find(e => e.alias === 'ns2');

    expect(tnsEntry?.uri).toBe('http://example.com/service');
    expect(ns2Entry?.uri).toBe('http://example.com/types');
  });
});
