// Teste real e nao destrutivo da infraestrutura: cria dados sinteticos em um laboratorio.
// Nunca executa GitHub Actions nem imprime senhas, tokens ou URLs assinadas.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const prefix=process.env.CATCH_UP_STACK_PREFIX;
const account=process.env.CATCH_UP_EXPECTED_ACCOUNT_ID;
const subject=process.env.CATCH_UP_GITHUB_SUB;
assert.ok(prefix&&account&&subject,'Informe prefixo, conta esperada e subject OIDC.');
const region=process.env.AWS_REGION||'us-east-1';
const profile=process.env.AWS_PROFILE;
const checks=[];
function aws(...args) {
  try {
    const output=execFileSync('aws',[...args,'--region',region,...(profile?['--profile',profile]:[]),'--output','json'],{encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']});
    return output.trim()?JSON.parse(output):{};
  } catch(error) {
    throw Error(`AWS ${args[0]} ${args[1]} falhou: ${error.stderr?.toString()||'consulte a AWS'}`);
  }
}
const actual=aws('sts','get-caller-identity');
assert.equal(actual.Account,account,'Conta diferente da esperada');
function stack(suffix) {
  const result=aws('cloudformation','describe-stacks','--stack-name',`${prefix}-${suffix}`).Stacks[0];
  assert.ok(['CREATE_COMPLETE','UPDATE_COMPLETE'].includes(result.StackStatus));
  assert.ok(result.Tags.some(tag=>tag.Key==='ManagedBy'&&tag.Value==='residencia-catch-up'));
  assert.ok(result.Tags.some(tag=>tag.Key==='Baseline'&&tag.Value==='ready-for-sprint-05'));
  return Object.fromEntries(result.Outputs.map(item=>[item.OutputKey,item.OutputValue]));
}
const web=stack('sprint-01');
const backend=stack('marketplace-backend');
const identity=stack('pipeline-identity');
const dataSource=process.env.CATCH_UP_DATA_SOURCE||'dynamodb';
assert.equal(backend.DataSource,dataSource);
const backendResources=aws('cloudformation','list-stack-resources','--stack-name',`${prefix}-marketplace-backend`).StackResourceSummaries;
if(dataSource==='dynamodb') {
  assert.ok(!backendResources.some(item=>['AWS::RDS::DBInstance','AWS::RDS::DBProxy','AWS::EC2::VPC','AWS::EC2::VPCEndpoint'].includes(item.ResourceType)),'Default nao deve criar RDS, Proxy, VPC nem endpoints');
}
const packages=[
  [backend.CatalogFunctionName,'01-catalog-backend-api-lambda/catalog-backend-api-lambda.zip'],
  [backend.OrderApiFunctionName,'02-order-backend-api-lambda/order-backend-api-lambda.zip'],
  [backend.OrderProcessorFunctionName,'03-order-processor-lambda/order-processor-lambda.zip'],
];
for(const [name,packagePath] of packages) {
  const config=aws('lambda','get-function-configuration','--function-name',name);
  assert.equal(config.Environment.Variables.DATA_SOURCE,dataSource);
  const zip=readFileSync(new URL('../../../backend/lambdas/'+packagePath,import.meta.url));
  assert.equal(config.CodeSha256,createHash('sha256').update(zip).digest('base64'),'Hash publicado deve corresponder ao ZIP local');
}
checks.push(`backend-${dataSource}-confirmado-nas-tres-lambdas`);
checks.push('hashes-dos-tres-zips-confirmados-na-aws');
const directory=fileURLToPath(new URL(`../../../build/catch-up/${prefix}/`,import.meta.url));
const variables=JSON.parse(readFileSync(join(directory,'repository-variables.json'),'utf8'));
assert.equal(Object.keys(variables).length,13);
assert.equal(variables.AWS_ROLE_ARN,identity.FrontendDeployRoleArn);
assert.equal(variables.BACKEND_AWS_ROLE_ARN,identity.BackendDeployRoleArn);
assert.equal(variables.FRONTEND_BUCKET,web.FrontendBucketName);
assert.equal(variables.VITE_API_URL,backend.ApiUrl);
assert.equal(variables.ORDER_API_FUNCTION,backend.OrderApiFunctionName);
checks.push('tres-stacks-completas-e-identificadas');
checks.push('repository-variables-correspondem-aos-recursos-reais');

for(const arn of [identity.FrontendDeployRoleArn,identity.BackendDeployRoleArn]) {
  const role=aws('iam','get-role','--role-name',arn.split('/').at(-1)).Role;
  const trust=role.AssumeRolePolicyDocument.Statement[0];
  assert.equal(trust.Action,'sts:AssumeRoleWithWebIdentity');
  assert.equal(trust.Principal.Federated,identity.GitHubOidcProviderArn);
  assert.equal(trust.Condition.StringEquals['token.actions.githubusercontent.com:aud'],'sts.amazonaws.com');
  assert.equal(trust.Condition.StringEquals['token.actions.githubusercontent.com:sub'],subject);
}
const provider=aws('iam','get-open-id-connect-provider','--open-id-connect-provider-arn',identity.GitHubOidcProviderArn);
assert.ok(provider.ClientIDList.includes('sts.amazonaws.com'));
checks.push('trust-oidc-restrita-ao-subject-main-e-audience');

async function permission(role,action,resource,allowed) {
  for(let attempt=0;attempt<8;attempt++) {
    const decision=aws('iam','simulate-principal-policy','--policy-source-arn',role,'--action-names',action,'--resource-arns',resource).EvaluationResults[0].EvalDecision;
    if((decision==='allowed')===allowed) return;
    if(attempt<7) await new Promise(resolve=>setTimeout(resolve,3000));
  }
  throw Error(`Permissao inesperada: ${action}, esperado ${allowed?'allow':'deny'}`);
}
await permission(identity.FrontendDeployRoleArn,'s3:PutObject',`arn:aws:s3:::${web.FrontendBucketName}/smoke.txt`,true);
await permission(identity.FrontendDeployRoleArn,'s3:PutObject','arn:aws:s3:::fora-deste-laboratorio/smoke.txt',false);
await permission(identity.FrontendDeployRoleArn,'s3:DeleteObject',`arn:aws:s3:::${web.FrontendBucketName}/smoke.txt`,false);
await permission(identity.FrontendDeployRoleArn,'cloudfront:CreateInvalidation',`arn:aws:cloudfront::${account}:distribution/${web.CloudFrontDistributionId}`,true);
for(const name of [backend.CatalogFunctionName,backend.OrderApiFunctionName,backend.OrderProcessorFunctionName]) {
  await permission(identity.BackendDeployRoleArn,'lambda:UpdateFunctionCode',`arn:aws:lambda:${region}:${account}:function:${name}`,true);
}
await permission(identity.BackendDeployRoleArn,'lambda:UpdateFunctionCode',`arn:aws:lambda:${region}:${account}:function:fora-deste-laboratorio`,false);
await permission(identity.BackendDeployRoleArn,'lambda:UpdateFunctionConfiguration',`arn:aws:lambda:${region}:${account}:function:${backend.CatalogFunctionName}`,false);
await permission(identity.BackendDeployRoleArn,'iam:CreateRole','*',false);
checks.push('permissoes-positivas-e-negativas-simuladas-pela-aws');
console.log('IAM: trust e limites de frontend/backend validados na AWS.');

const homepage=await fetch(web.FrontendUrl,{signal:AbortSignal.timeout(30000)});
assert.equal(homepage.status,200);
const html=await homepage.text();
assert.match(html,/<div id="root"/);
const scriptPath=html.match(/src="([^"]+\.js)"/)?.[1];
assert.ok(scriptPath,'HTML deve referenciar o bundle do Vite');
const script=await fetch(new URL(scriptPath,web.FrontendUrl),{signal:AbortSignal.timeout(30000)});
assert.ok(script.ok&&!script.headers.get('content-type')?.includes('text/html'),'Bundle deve ser entregue como JavaScript, nao o fallback HTML');
const direct=await fetch(`https://${web.FrontendBucketName}.s3.${region}.amazonaws.com/index.html`,{signal:AbortSignal.timeout(30000)});
assert.equal(direct.status,403,'S3 deve negar leitura anonima');
checks.push('frontend-https-e-origem-s3-privada');

const email=`catchup.${Date.now()}@example.com`;
const password=`T3st!${randomBytes(20).toString('hex')}`;
let userCreated=false;
try {
  aws('cognito-idp','admin-create-user','--user-pool-id',backend.UserPoolId,'--username',email,'--message-action','SUPPRESS','--user-attributes',`Name=email,Value=${email}`,'Name=email_verified,Value=true','Name=name,Value=Teste catch-up');
  userCreated=true;
  aws('cognito-idp','admin-set-user-password','--user-pool-id',backend.UserPoolId,'--username',email,'--password',password,'--permanent');
  const require=createRequire(new URL('../../../site/package.json',import.meta.url));
  const {CognitoUserPool,CognitoUser,AuthenticationDetails}=require('amazon-cognito-identity-js');
  const pool=new CognitoUserPool({UserPoolId:backend.UserPoolId,ClientId:backend.UserPoolClientId});
  const user=new CognitoUser({Username:email,Pool:pool});
  const token=await new Promise((resolve,reject)=>user.authenticateUser(new AuthenticationDetails({Username:email,Password:password}),{onSuccess:session=>resolve(session.getIdToken().getJwtToken()),onFailure:reject}));
  const api=async(path,body,method=body?'POST':'GET')=>{
    const response=await fetch(backend.ApiUrl+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    const result=await response.json();
    if(!response.ok) throw Error(`API ${method} ${path}: HTTP ${response.status} ${JSON.stringify(result)}`);
    return result;
  };
  const product=await api('/products',{name:'Produto catch-up AWS',description:'Dado sintetico de teste',priceCents:1590,stock:5,images:[{fileName:'teste.txt',contentType:'text/plain'}]});
  assert.ok(product.product?.id&&product.imageUploads?.[0]?.uploadUrl);
  const upload=await fetch(product.imageUploads[0].uploadUrl,{method:'PUT',headers:{'Content-Type':'text/plain'},body:'imagem-catchup-e2e',signal:AbortSignal.timeout(30000)});
  assert.ok(upload.ok);
  const order=await api('/orders',{productId:product.product.id,quantity:2});
  assert.ok(order.orderId&&order.status==='pending');
  let processed=false;
  for(let attempt=0;attempt<30;attempt++) {
    const orders=await api('/orders');
    if(orders.items?.some(item=>item.id===order.orderId&&item.status==='processed')) {processed=true;break;}
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  assert.ok(processed,'Pedido deve ser processado pelo SQS');
  const seller=await api('/seller/orders');
  assert.ok(seller.items.some(item=>item.id===order.orderId&&item.status==='processed'));
  const products=await api('/products');
  const current=products.items.find(item=>item.id===product.product.id);
  assert.equal(current.stock,3);
  const image=await fetch(current.imageUrls[0],{signal:AbortSignal.timeout(30000)});
  assert.equal(await image.text(),'imagem-catchup-e2e');
  checks.push(`cognito-catalogo-${dataSource}-imagens-orders-dotnet-sqs-processamento-estoque`);
  console.log(`Aplicacao: login, ${dataSource}, imagem, pedido, SQS e estoque validados.`);
} finally {
  if(userCreated) aws('cognito-idp','admin-delete-user','--user-pool-id',backend.UserPoolId,'--username',email);
}
mkdirSync(directory,{recursive:true});
writeFileSync(join(directory,'aws-test-report.json'),JSON.stringify({validatedAt:new Date().toISOString(),account,region,prefix,checks,githubActionsExecuted:false,web,backend,identity},null,2)+'\n',{mode:0o600});
console.log('Teste AWS concluido. Relatorio sem credenciais salvo em build/catch-up/'+prefix+'/aws-test-report.json');
