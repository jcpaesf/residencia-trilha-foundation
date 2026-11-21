import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function validateSubject(repository,subject) {
  if(typeof subject!=='string'||/[\r\n\0]/.test(subject)) throw Error('Subject OIDC invalido: use uma unica linha.');
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||'')) throw Error('Use CATCH_UP_GITHUB_REPO=OWNER/REPO.');
  const match=/^repo:([^/@:]+)(?:@([0-9]+))?\/([^/@:]+)(?:@([0-9]+))?:ref:refs\/heads\/main$/.exec(subject||'');
  if(!match||`${match[1]}/${match[3]}`!==repository||Boolean(match[2])!==Boolean(match[4])) {
    throw Error('CATCH_UP_GITHUB_SUB deve corresponder exatamente ao fork e a main; sem curingas, PRs ou environments. Inclua ambos os IDs se o fork usar subject imutavel.');
  }
  return subject;
}

export function repositoryVariables(region,web,backend,identity) {
  const outputs=items=>Object.fromEntries(items.map(item=>[item.OutputKey,item.OutputValue]));
  const w=outputs(web),b=outputs(backend),i=outputs(identity);
  const variables={
    AWS_REGION:region,
    AWS_ROLE_ARN:i.FrontendDeployRoleArn,
    BACKEND_AWS_ROLE_ARN:i.BackendDeployRoleArn,
    FRONTEND_BUCKET:w.FrontendBucketName,
    CLOUDFRONT_DISTRIBUTION_ID:w.CloudFrontDistributionId,
    FRONTEND_URL:w.FrontendUrl,
    VITE_AWS_REGION:region,
    VITE_COGNITO_USER_POOL_ID:b.UserPoolId,
    VITE_COGNITO_CLIENT_ID:b.UserPoolClientId,
    VITE_API_URL:b.ApiUrl,
    CATALOG_FUNCTION:b.CatalogFunctionName,
    ORDER_API_FUNCTION:b.OrderApiFunctionName,
    ORDER_PROCESSOR_FUNCTION:b.OrderProcessorFunctionName,
  };
  for(const [name,value] of Object.entries(variables)) {
    if(typeof value!=='string'||!value||value==='None'||/[\r\n\0]/.test(value)) throw Error(`Output ausente ou invalido para ${name}; nenhuma configuracao sera gerada.`);
  }
  return variables;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [action,...args]=process.argv.slice(2);
  if(action==='validate-subject') {
    validateSubject(...args);
    console.log('Subject OIDC validado para o fork e a main.');
  } else if(action==='write') {
    const [directory,region,web,backend,identity]=args;
    const variables=repositoryVariables(region,JSON.parse(web),JSON.parse(backend),JSON.parse(identity));
    mkdirSync(directory,{recursive:true});
    writeFileSync(join(directory,'repository-variables.json'),JSON.stringify(variables,null,2)+'\n',{mode:0o600});
    writeFileSync(join(directory,'repository-variables.env'),Object.entries(variables).map(([name,value])=>`${name}=${value}`).join('\n')+'\n',{mode:0o600});
    console.log(`Repository Variables (sem credenciais): ${join(directory,'repository-variables.env')}`);
  } else {
    throw Error('Use validate-subject OWNER/REPO SUBJECT ou write DIRETORIO REGIAO WEB_JSON BACKEND_JSON IAM_JSON.');
  }
}
