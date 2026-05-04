import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'graphql';
import type { MeshFetch } from '@graphql-mesh/types';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import { createExecutorFromSchemaAST, SOAPLoader } from '@omnigraph/soap';
import { fetch, Response } from '@whatwg-node/fetch';
import { dummyLogger as logger } from '../../../testing/dummyLogger';

describe('SOAP multi-namespace', () => {
  it('should use per-namespace prefixes in the request body', async () => {
    const soapLoader = new SOAPLoader({ subgraphName: 'Test', fetch, logger });
    await soapLoader.loadWSDL(
      readFileSync(join(__dirname, './fixtures/multi-namespace.wsdl'), 'utf-8'),
    );
    const schema = soapLoader.buildSchema();
    const responseXml = `
      <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
        <soap:Body>
          <GetDataResponse><result>ok</result></GetDataResponse>
        </soap:Body>
      </soap:Envelope>
    `;
    const fetchSpy = jest.fn(
      (_url: string, _init: RequestInit) =>
        new Response(responseXml, { status: 200, headers: { 'Content-Type': 'text/xml' } }),
    );
    const executor = createExecutorFromSchemaAST(schema, fetchSpy as unknown as MeshFetch);
    await executor({
      document: parse(/* GraphQL */ `
        {
          MultiNsService_MultiNsService_MultiNsPort_GetData(GetData: { id: "test-id" }) {
            result
          }
        }
      `),
    });
    const body: string = fetchSpy.mock.calls[0][1].body;
    expect(body).toContain('types:GetData');
    expect(body).not.toContain('tns:GetData');
    expect(body).toMatchSnapshot('multi-namespace-body');
  });
});

describe('SOAP Headers', () => {
  it('should pass headers to the executor', async () => {
    const soapLoader = new SOAPLoader({
      subgraphName: 'Test',
      fetch,
      logger,
      bodyAlias: 'guild',
      soapHeaders: {
        alias: 'guild',
        namespace: 'https://the-guild.dev',
        headers: {
          MyHeader: {
            UserName: '{context.USER_NAME}',
            Password: '{context.PASSWORD}',
          },
        },
      },
    });
    await soapLoader.loadWSDL(
      readFileSync(join(__dirname, './fixtures/globalweather.wsdl'), 'utf-8'),
    );
    const schema = soapLoader.buildSchema();
    expect(printSchemaWithDirectives(schema)).toMatchSnapshot('soap-with-headers');
    const fetchSpy = jest.fn((_url: string, _init: RequestInit) => Response.error());
    const executor = createExecutorFromSchemaAST(schema, fetchSpy);
    await executor({
      document: parse(/* GraphQL */ `
        {
          tns_GlobalWeather_GlobalWeatherSoap_GetWeather(
            GetWeather: { CityName: "Rome", CountryName: "Italy" }
          ) {
            GetWeatherResult
          }
        }
      `),
      context: {
        USER_NAME: 'user',
        PASSWORD: 'password',
      },
    });
    // namespaceMap now declares all WSDL xmlns prefixes on the envelope; body uses the WSDL
    // binding namespace alias (tns) while headers retain the user-supplied guild alias.
    expect(fetchSpy.mock.calls[0][1].body).toMatchSnapshot('soap-headers-body');
  });
});
