/* eslint-disable import/no-nodejs-modules */
import { promises as fsPromises } from 'fs';
import { globalAgent } from 'https';
import { join } from 'path';
import { parse } from 'graphql';
import type { MeshFetch } from '@graphql-mesh/types';
import { getDirectiveExtensions, printSchemaWithDirectives } from '@graphql-tools/utils';
import { fetch } from '@whatwg-node/fetch';
import { dummyLogger as logger } from '../../../testing/dummyLogger';
import { createExecutorFromSchemaAST, SOAPLoader } from '../src/index.js';

describe('SOAP Loader', () => {
  afterEach(() => {
    globalAgent.destroy();
  });
  // TODO: Implement this locally later
  // Now E2E tests have it covered
  it.skip('should execute SOAP calls correctly', async () => {
    const soapLoader = new SOAPLoader({
      subgraphName: 'Test',
      fetch,
      logger,
    });
    await soapLoader.fetchWSDL('https://www.crcind.com/csp/samples/SOAP.Demo.cls?WSDL');
    const schema = soapLoader.buildSchema();
    const executor = createExecutorFromSchemaAST(schema, fetch);
    const result: any = await executor({
      document: parse(/* GraphQL */ `
        mutation AddInteger {
          s0_SOAPDemo_SOAPDemoSoap_AddInteger(AddInteger: { Arg1: 2, Arg2: 3 }) {
            AddIntegerResult
          }
        }
      `),
    });
    // eslint-disable-next-line eqeqeq
    expect(result?.data?.s0_SOAPDemo_SOAPDemoSoap_AddInteger.AddIntegerResult).toEqual(5);
  });

  it('should create executor for a service with mutations and query placeholder', async () => {
    const soapLoader = new SOAPLoader({
      subgraphName: 'Test',
      fetch,
      logger,
    });
    const example1Wsdl = await fsPromises.readFile(
      join(__dirname, './fixtures/greeting.wsdl'),
      'utf8',
    );
    await soapLoader.loadWSDL(example1Wsdl);
    const schema = soapLoader.buildSchema();
    expect(printSchemaWithDirectives(schema)).toMatchSnapshot();

    const executor = createExecutorFromSchemaAST(schema, (() => {}) as unknown as MeshFetch);

    let err;
    try {
      await executor({
        document: parse(/* GraphQL */ `
          {
            placeholder
          }
        `),
      });
    } catch (e) {
      err = e;
    }

    expect(err).toBeUndefined();
  });

  it('should build correct schema with namespaceMap for multi-namespace WSDL', async () => {
    const soapLoader = new SOAPLoader({ subgraphName: 'Test', fetch, logger });
    const wsdl = await fsPromises.readFile(
      join(__dirname, './fixtures/multi-namespace.wsdl'),
      'utf8',
    );
    await soapLoader.loadWSDL(wsdl);
    const schema = soapLoader.buildSchema();
    const printed = printSchemaWithDirectives(schema);
    expect(printed).toContain('namespaceMap');
    expect(printed).toMatchSnapshot();
  });

  it('should resolve bindingNamespace to XSD type namespace for multi-namespace WSDL', async () => {
    const soapLoader = new SOAPLoader({ subgraphName: 'Test', fetch, logger });
    const wsdl = await fsPromises.readFile(
      join(__dirname, './fixtures/multi-namespace.wsdl'),
      'utf8',
    );
    await soapLoader.loadWSDL(wsdl);
    const schema = soapLoader.buildSchema();
    const queryFields = schema.getQueryType()?.getFields() ?? {};
    const mutationFields = schema.getMutationType()?.getFields() ?? {};
    const allFields = { ...queryFields, ...mutationFields };
    const getDataField = Object.values(allFields).find(f => f.name.includes('GetData'));
    expect(getDataField).toBeDefined();
    const directives = getDirectiveExtensions<{ soap: { bindingNamespace: string } }>(getDataField);
    const soapDirective = directives?.soap?.[0];
    expect(soapDirective?.bindingNamespace).toBe('http://example.com/types');
  });
});
