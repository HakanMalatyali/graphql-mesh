import { XMLBuilder as JSONToXMLConverter, XMLParser } from 'fast-xml-parser';
import type {
  GraphQLFieldResolver,
  GraphQLInputObjectType,
  GraphQLOutputType,
  GraphQLResolveInfo,
  GraphQLSchema,
} from 'graphql';
import { isListType, isNonNullType } from 'graphql';
import { process } from '@graphql-mesh/cross-helpers';
import type { ResolverData, ResolverDataBasedFactory } from '@graphql-mesh/string-interpolation';
import {
  getInterpolatedHeadersFactory,
  stringInterpolator,
} from '@graphql-mesh/string-interpolation';
import type { Logger, MeshFetch } from '@graphql-mesh/types';
import { DefaultLogger } from '@graphql-mesh/utils';
import { normalizedExecutor } from '@graphql-tools/executor';
import {
  createGraphQLError,
  getDirectiveExtensions,
  getRootTypes,
  type Executor,
} from '@graphql-tools/utils';
import { fetch as defaultFetchFn } from '@whatwg-node/fetch';
import { parseXmlOptions } from './parseXmlOptions.js';

function isOriginallyListType(type: GraphQLOutputType): boolean {
  if (isNonNullType(type)) {
    return isOriginallyListType(type.ofType);
  }
  return isListType(type);
}

const defaultFieldResolver: GraphQLFieldResolver<any, any> = function soapDefaultResolver(
  root,
  args,
  context,
  info,
) {
  const rootField = root[info.fieldName];
  if (typeof rootField === 'function') {
    return rootField(args, context, info);
  }
  const isArray = Array.isArray(rootField);
  const isPlural = isOriginallyListType(info.returnType);
  if (isPlural && !isArray) {
    return [rootField];
  }
  if (!isPlural && isArray) {
    return rootField[0];
  }
  return rootField;
};

function normalizeArgsForConverter(args: any): any {
  if (args != null) {
    if (typeof args === 'object') {
      for (const key in args) {
        args[key] = normalizeArgsForConverter(args[key]);
      }
    } else {
      return {
        innerText: args,
      };
    }
  }
  return args;
}

function normalizeResult(result: any) {
  if (result != null && typeof result === 'object') {
    for (const key in result) {
      if (key === 'innerText') {
        return result.innerText;
      }
      result[key] = normalizeResult(result[key]);
    }
    if (Array.isArray(result) && result.length === 1) {
      return result[0];
    }
  }
  return result;
}

type RootValueMethod = (args: any, context: any, info: GraphQLResolveInfo) => Promise<any>;

interface SoapAnnotations {
  subgraph: string;
  endpoint: string;
  bindingNamespace: string;
  elementName: string;
  soapNamespace: string;
  bodyAlias?: string;
  soapHeaders?: {
    alias?: string;
    namespace: string;
    headers: Record<string, string>;
  };
  soapAction?: string;
  namespaceMap?: Array<{ alias: string; uri: string }>;
}

interface CreateRootValueMethodOpts {
  soapAnnotations: SoapAnnotations;
  fetchFn: MeshFetch;
  jsonToXMLConverter: JSONToXMLConverter;
  xmlToJSONConverter: XMLParser;
  operationHeadersFactory: ResolverDataBasedFactory<Record<string, string>>;
  logger: Logger;
  schema: GraphQLSchema;
}

function prefixWithAlias({
  alias,
  obj,
  resolverData,
}: {
  alias: string;
  obj: unknown;
  resolverData?: ResolverData;
}): Record<string, any> {
  if (typeof obj === 'object' && obj !== null) {
    const prefixedHeaderObj: Record<string, any> = {};
    for (const key in obj) {
      const aliasedKey = key === 'innerText' ? key : `${alias}:${key}`;
      prefixedHeaderObj[aliasedKey] = prefixWithAlias({
        alias,
        obj: obj[key],
        resolverData,
      });
    }
    return prefixedHeaderObj;
  }
  if (typeof obj === 'string' && resolverData) {
    return stringInterpolator.parse(obj, resolverData);
  }
  return obj;
}

function buildNamespacedValue(
  value: any,
  currentType: GraphQLInputObjectType | null,
  schema: GraphQLSchema,
  uriToAlias: Map<string, string>,
  resolverData: ResolverData,
  defaultAlias: string = '',
): any {
  if (value == null) return value;

  if (typeof value !== 'object') {
    const strVal =
      typeof value === 'string' ? stringInterpolator.parse(value, resolverData) : value;
    return { innerText: strVal };
  }

  if (Array.isArray(value)) {
    return value.map(item =>
      buildNamespacedValue(item, currentType, schema, uriToAlias, resolverData, defaultAlias),
    );
  }

  const fields = currentType ? currentType.getFields() : null;
  const result: Record<string, any> = {};

  for (const key of Object.keys(value) as string[]) {
    if (key === 'innerText') {
      result[key] = value[key];
      continue;
    }

    let fieldAlias = '';
    let childType: GraphQLInputObjectType | null = null;

    if (fields && fields[key]) {
      let fieldType: any = fields[key].type;
      while (fieldType && fieldType.ofType) fieldType = fieldType.ofType;

      if (fieldType?.name) {
        const ns: string | undefined = (fieldType.extensions as any)?.soapNamespace;
        if (ns) {
          if (!uriToAlias.has(ns)) {
            const generated = ns
              .replace(/^https?:\/\//, '')
              .replace(/[^a-zA-Z0-9]+/g, '_')
              .replace(/^_+|_+$/g, '');
            uriToAlias.set(ns, generated);
          }
          fieldAlias = uriToAlias.get(ns)!;
        }
        const resolved = schema.getType(fieldType.name);
        if (resolved && 'getFields' in resolved) {
          childType = resolved as GraphQLInputObjectType;
          // @soapType directive survives SDL round-trip; use it when extensions are lost
          if (!fieldAlias) {
            const soapTypeDir = (resolved as any).astNode?.directives?.find(
              (d: any) => d.name.value === 'soapType',
            );
            const dirNs = soapTypeDir?.arguments?.find(
              (a: any) => a.name.value === 'namespace',
            )?.value?.value;
            if (dirNs) {
              if (!uriToAlias.has(dirNs)) {
                const generated = dirNs
                  .replace(/^https?:\/\//, '')
                  .replace(/[^a-zA-Z0-9]+/g, '_')
                  .replace(/^_+|_+$/g, '');
                uriToAlias.set(dirNs, generated);
              }
              fieldAlias = uriToAlias.get(dirNs) || '';
            }
          }
        }
      }
    }

    // Fall back to the parent's namespace alias when no type-level namespace is found
    if (!fieldAlias) fieldAlias = defaultAlias;

    // Element namespace = declaration namespace (defaultAlias = parent's namespace).
    // Type namespace (fieldAlias) propagates as the new defaultAlias for children.
    const prefixedKey = defaultAlias ? `${defaultAlias}:${key}` : key;
    result[prefixedKey] = buildNamespacedValue(
      value[key],
      childType,
      schema,
      uriToAlias,
      resolverData,
      fieldAlias,
    );
  }

  return result;
}

function createRootValueMethod({
  soapAnnotations,
  fetchFn,
  jsonToXMLConverter,
  xmlToJSONConverter,
  operationHeadersFactory,
  logger,
  schema,
}: CreateRootValueMethodOpts): RootValueMethod {
  if (!soapAnnotations.soapNamespace) {
    logger.warn(`The expected 'soapNamespace' attribute is missing in SOAP directive definition.
Update the SOAP source handler, and re-generate the schema.
Falling back to 'http://www.w3.org/2003/05/soap-envelope' as SOAP Namespace.`);
    soapAnnotations.soapNamespace = 'http://www.w3.org/2003/05/soap-envelope';
  }
  return async function rootValueMethod(args: any, context: any, info: GraphQLResolveInfo) {
    const envelopeAttributes: Record<string, string> = {
      'xmlns:soap': soapAnnotations.soapNamespace,
    };
    const envelope: Record<string, any> = {
      attributes: envelopeAttributes,
    };
    const resolverData: ResolverData = {
      args,
      context,
      info,
      env: process.env,
    };

    const uriToAlias = new Map<string, string>(
      (soapAnnotations.namespaceMap ?? []).map(({ alias, uri }) => [uri, alias]),
    );
    const bindingAlias =
      soapAnnotations.namespaceMap?.length && soapAnnotations.bindingNamespace
        ? (uriToAlias.get(soapAnnotations.bindingNamespace) ?? '')
        : '';

    // Declare all known namespaces on the envelope from namespaceMap when available,
    // otherwise fall back to a single bodyPrefix alias for the binding namespace.
    if (soapAnnotations.namespaceMap?.length) {
      for (const { alias, uri } of soapAnnotations.namespaceMap) {
        const k = `xmlns:${alias}`;
        if (!envelopeAttributes[k]) envelopeAttributes[k] = uri;
      }
    } else {
      const bodyPrefix = soapAnnotations.bodyAlias || 'body';
      envelopeAttributes[`xmlns:${bodyPrefix}`] = soapAnnotations.bindingNamespace;
    }

    const headerPrefix =
      soapAnnotations.soapHeaders?.alias || soapAnnotations.bodyAlias || 'header';
    if (soapAnnotations.soapHeaders?.headers) {
      envelope['soap:Header'] = prefixWithAlias({
        alias: headerPrefix,
        obj: normalizeArgsForConverter(
          typeof soapAnnotations.soapHeaders.headers === 'string'
            ? JSON.parse(soapAnnotations.soapHeaders.headers)
            : soapAnnotations.soapHeaders.headers,
        ),
        resolverData,
      });
      if (soapAnnotations.soapHeaders?.namespace) {
        envelopeAttributes[`xmlns:${headerPrefix}`] = soapAnnotations.soapHeaders.namespace;
      }
    }

    const fieldDef = (info.parentType as any).getFields?.()?.[info.fieldName];
    const argDefs: readonly any[] = fieldDef?.args ?? [];
    const bodyObj: Record<string, any> = {};
    for (const argDef of argDefs) {
      const argName: string = argDef.name;
      if (!(argName in args)) continue;
      let argType: any = argDef.type;
      while (argType?.ofType) argType = argType.ofType;
      let argInputType: GraphQLInputObjectType | null = null;
      if (argType?.name) {
        const resolved = schema.getType(argType.name);
        if (resolved && 'getFields' in resolved) {
          argInputType = resolved as GraphQLInputObjectType;
        }
      }
      const prefixedArgName = bindingAlias ? `${bindingAlias}:${argName}` : argName;
      bodyObj[prefixedArgName] = buildNamespacedValue(
        args[argName],
        argInputType,
        schema,
        uriToAlias,
        resolverData,
        bindingAlias,
      );
    }
    for (const [uri, alias] of uriToAlias) {
      const xmlnsKey = `xmlns:${alias}`;
      if (!envelopeAttributes[xmlnsKey]) envelopeAttributes[xmlnsKey] = uri;
    }
    envelope['soap:Body'] = bodyObj;

    const requestJson = {
      'soap:Envelope': envelope,
    };
    const requestXML = jsonToXMLConverter.build(requestJson);
    const currentFetchFn = context?.fetch || fetchFn;
    const response = await currentFetchFn(
      soapAnnotations.endpoint,
      {
        method: 'POST',
        body: requestXML,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: soapAnnotations.soapAction,
          ...operationHeadersFactory({
            args,
            context,
            info,
            env: process.env,
          }),
        },
      },
      context,
      info,
    );
    const responseXML = await response.text();
    if (!response.ok) {
      return createGraphQLError(`Upstream HTTP Error: ${response.status}`, {
        extensions: {
          code: 'DOWNSTREAM_SERVICE_ERROR',
          serviceName: soapAnnotations.subgraph,
          request: {
            url: soapAnnotations.endpoint,
            method: 'POST',
            body: requestXML,
          },
          response: {
            status: response.status,
            statusText: response.statusText,
            get headers() {
              return Object.fromEntries(response.headers.entries());
            },
            body: responseXML,
          },
        },
      });
    }
    try {
      const responseJSON = xmlToJSONConverter.parse(responseXML, parseXmlOptions);
      const envelope = responseJSON?.Envelope?.[0];
      const body = envelope?.Body?.[0];
      const result = body?.[soapAnnotations.elementName];
      if (result === undefined) {
        throw new Error(
          `Response body does not contain expected element '${soapAnnotations.elementName}'`,
        );
      }
      return normalizeResult(result);
    } catch (e) {
      return createGraphQLError(`Invalid SOAP response: ${e.message}`, {
        extensions: {
          subgraph: soapAnnotations.subgraph,
          request: {
            url: soapAnnotations.endpoint,
            method: 'POST',
            body: requestXML,
          },
          response: {
            status: response.status,
            statusText: response.statusText,
            get headers() {
              return Object.fromEntries(response.headers.entries());
            },
            body: responseXML,
          },
        },
      });
    }
  };
}

function createRootValue(
  schema: GraphQLSchema,
  fetchFn: MeshFetch,
  operationHeaders: Record<string, string>,
  logger: Logger,
) {
  const rootValue: Record<string, RootValueMethod> = {};
  const rootTypes = getRootTypes(schema);

  const jsonToXMLConverter = new JSONToXMLConverter({
    attributeNamePrefix: '',
    attributesGroupName: 'attributes',
    textNodeName: 'innerText',
  });
  const xmlToJSONConverter = new XMLParser(parseXmlOptions);

  const operationHeadersFactory = getInterpolatedHeadersFactory(operationHeaders);
  for (const rootType of rootTypes) {
    const rootFieldMap = rootType.getFields();
    for (const fieldName in rootFieldMap) {
      const fieldDirectives = getDirectiveExtensions<{
        soap: SoapAnnotations;
      }>(rootFieldMap[fieldName]);
      const soapDirectives = fieldDirectives?.soap;
      if (!soapDirectives?.length) {
        // skip fields without @soap directive
        // we have to skip Query.placeholder field when only mutations were created
        continue;
      }
      for (const soapAnnotations of soapDirectives) {
        rootValue[fieldName] = createRootValueMethod({
          soapAnnotations,
          fetchFn,
          jsonToXMLConverter,
          xmlToJSONConverter,
          operationHeadersFactory,
          logger,
          schema,
        });
      }
    }
  }
  return rootValue;
}

export function createExecutorFromSchemaAST(
  schema: GraphQLSchema,
  fetchFn: MeshFetch = defaultFetchFn,
  operationHeaders: Record<string, string> = {},
  logger: Logger = new DefaultLogger(),
): Executor {
  let rootValue: Record<string, RootValueMethod>;
  return function soapExecutor({ document, variables, context }) {
    if (!rootValue) {
      rootValue = createRootValue(schema, fetchFn, operationHeaders, logger);
    }
    return normalizedExecutor({
      schema,
      document,
      rootValue,
      contextValue: context,
      variableValues: variables,
      fieldResolver: defaultFieldResolver,
    });
  };
}
