import { pathToFileURL } from 'node:url';
export { evaluateReportingSuite, type ReportingObservation } from './reporting.js';
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify({worker:'verifier-supervisor',state:'local-reporting-api',authenticatedReports:true,isolation:'not-provisioned',semanticEvaluation:'not-integrated',extensionIntegration:'native-host synthetic reporting'}));
