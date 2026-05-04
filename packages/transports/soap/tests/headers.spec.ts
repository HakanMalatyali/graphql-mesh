import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'graphql';
import type { MeshFetch } from '@graphql-mesh/types';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import { createExecutorFromSchemaAST, SOAPLoader } from '@omnigraph/soap';
import { fetch, Response } from '@whatwg-node/fetch';
import { dummyLogger as logger } from '../../../testing/dummyLogger';

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
    const executor = createExecutorFromSchemaAST(schema, fetchSpy as unknown as MeshFetch);
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
    const body = fetchSpy.mock.calls[0][1].body as string;

    // Header must use the explicitly configured alias (guild:)
    expect(body).toContain('<guild:MyHeader>');
    expect(body).toContain('<guild:UserName>user</guild:UserName>');
    expect(body).toContain('<guild:Password>password</guild:Password>');
    expect(body).toContain('xmlns:guild="https://the-guild.dev"');

    // Body elements use the WSDL's native namespace alias (tns:) resolved from namespaceMap.
    // bodyAlias no longer overrides the body prefix — the WSDL alias is always preferred.
    expect(body).toContain('<tns:GetWeather>');
    expect(body).toContain('<tns:CityName>Rome</tns:CityName>');
    expect(body).toContain('<tns:CountryName>Italy</tns:CountryName>');
    expect(body).toContain('xmlns:tns="http://www.webserviceX.NET"');
  });
});
