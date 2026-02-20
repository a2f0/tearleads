/**
 * Find AWS resources that exist in the account but are NOT managed by Terraform
 *
 * Usage: npx tsx scripts/costModel/index.ts orphans [--region us-east-1]
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const STATE_BUCKET = 'tearleads-terraform-state';
const DEFAULT_REGION = 'us-east-1';

// ANSI colors
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const BLUE = '\x1b[0;34m';
const NC = '\x1b[0m';

function logInfo(msg: string): void {
  console.log(`${BLUE}[INFO]${NC} ${msg}`);
}

function logWarn(msg: string): void {
  console.log(`${YELLOW}[WARN]${NC} ${msg}`);
}

function logSuccess(msg: string): void {
  console.log(`${GREEN}[OK]${NC} ${msg}`);
}

function logOrphan(msg: string): void {
  console.log(`${RED}[ORPHAN]${NC} ${msg}`);
}

function exec(cmd: string): string {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch {
    return '';
  }
}

interface TerraformResource {
  type: string;
  instances?: Array<{
    attributes?: {
      id?: string;
      arn?: string;
      name?: string;
    };
  }>;
}

interface TerraformState {
  resources?: TerraformResource[];
}

function extractManagedResources(stateFile: string): Set<string> {
  const managed = new Set<string>();
  try {
    const content = fs.readFileSync(stateFile, 'utf-8');
    const state: TerraformState = JSON.parse(content);

    for (const resource of state.resources ?? []) {
      if (!resource.type.startsWith('aws_')) continue;

      for (const instance of resource.instances ?? []) {
        const id =
          instance.attributes?.id ??
          instance.attributes?.arn ??
          instance.attributes?.name;
        if (id) {
          managed.add(`${resource.type}:${id}`);
        }
      }
    }
  } catch {
    // Skip malformed state files
  }
  return managed;
}

function isManaged(
  managedResources: Set<string>,
  resourceType: string,
  resourceId: string
): boolean {
  return managedResources.has(`${resourceType}:${resourceId}`);
}

function checkS3Buckets(managedResources: Set<string>): number {
  logInfo('Checking S3 buckets...');
  let orphanCount = 0;

  const output = exec(
    `aws s3api list-buckets --query 'Buckets[].Name' --output text`
  );
  const buckets = output.trim().split(/\s+/).filter(Boolean);

  for (const bucket of buckets) {
    if (!isManaged(managedResources, 'aws_s3_bucket', bucket)) {
      logOrphan(`S3 Bucket: ${bucket}`);
      orphanCount++;
    }
  }
  return orphanCount;
}

function checkEcrRepositories(
  managedResources: Set<string>,
  region: string
): number {
  logInfo('Checking ECR repositories...');
  let orphanCount = 0;

  const output = exec(
    `aws ecr describe-repositories --query 'repositories[].repositoryName' --output text --region ${region}`
  );
  const repos = output.trim().split(/\s+/).filter(Boolean);

  for (const repo of repos) {
    if (!isManaged(managedResources, 'aws_ecr_repository', repo)) {
      logOrphan(`ECR Repository: ${repo}`);
      orphanCount++;
    }
  }
  return orphanCount;
}

function checkRdsInstances(
  managedResources: Set<string>,
  region: string
): number {
  logInfo('Checking RDS instances...');
  let orphanCount = 0;

  const output = exec(
    `aws rds describe-db-instances --query 'DBInstances[].DBInstanceIdentifier' --output text --region ${region}`
  );
  const instances = output.trim().split(/\s+/).filter(Boolean);

  for (const instance of instances) {
    if (!isManaged(managedResources, 'aws_db_instance', instance)) {
      logOrphan(`RDS Instance: ${instance}`);
      orphanCount++;
    }
  }
  return orphanCount;
}

function checkDynamoDbTables(
  managedResources: Set<string>,
  region: string
): number {
  logInfo('Checking DynamoDB tables...');
  let orphanCount = 0;

  const output = exec(
    `aws dynamodb list-tables --query 'TableNames[]' --output text --region ${region}`
  );
  const tables = output.trim().split(/\s+/).filter(Boolean);

  for (const table of tables) {
    // Skip terraform state lock table
    if (table === 'tearleads-terraform-locks') continue;

    if (!isManaged(managedResources, 'aws_dynamodb_table', table)) {
      logOrphan(`DynamoDB Table: ${table}`);
      orphanCount++;
    }
  }
  return orphanCount;
}

function checkIamUsers(managedResources: Set<string>): number {
  logInfo('Checking IAM users...');
  let orphanCount = 0;

  const output = exec(
    `aws iam list-users --query 'Users[].UserName' --output text`
  );
  const users = output.trim().split(/\s+/).filter(Boolean);

  for (const user of users) {
    if (!isManaged(managedResources, 'aws_iam_user', user)) {
      logOrphan(`IAM User: ${user}`);
      orphanCount++;
    }
  }
  return orphanCount;
}

function checkIamRoles(managedResources: Set<string>): number {
  logInfo('Checking IAM roles...');
  let orphanCount = 0;

  const output = exec(
    `aws iam list-roles --query 'Roles[].RoleName' --output text`
  );
  const roles = output.trim().split(/\s+/).filter(Boolean);

  for (const role of roles) {
    // Skip AWS service-linked roles and AWS-managed roles
    if (
      role.startsWith('AWSServiceRole') ||
      role.startsWith('aws-') ||
      role.startsWith('AWS')
    ) {
      continue;
    }

    if (!isManaged(managedResources, 'aws_iam_role', role)) {
      logOrphan(`IAM Role: ${role}`);
      orphanCount++;
    }
  }
  return orphanCount;
}

function checkSecurityGroups(
  managedResources: Set<string>,
  region: string
): number {
  logInfo('Checking security groups...');
  let orphanCount = 0;

  const output = exec(
    `aws ec2 describe-security-groups --query 'SecurityGroups[].[GroupId,GroupName]' --output text --region ${region}`
  );
  const lines = output.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    const [sgId, sgName] = line.split('\t');
    if (!sgId || sgName === 'default') continue;

    if (!isManaged(managedResources, 'aws_security_group', sgId)) {
      logOrphan(`Security Group: ${sgId} (${sgName})`);
      orphanCount++;
    }
  }
  return orphanCount;
}

function checkRoute53Zones(managedResources: Set<string>): number {
  logInfo('Checking Route53 hosted zones...');
  let orphanCount = 0;

  const output = exec(
    `aws route53 list-hosted-zones --query 'HostedZones[].[Id,Name]' --output text`
  );
  const lines = output.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    const [zoneIdFull, zoneName] = line.split('\t');
    if (!zoneIdFull) continue;

    const zoneId = zoneIdFull.replace('/hostedzone/', '');

    if (!isManaged(managedResources, 'aws_route53_zone', zoneId)) {
      logOrphan(`Route53 Zone: ${zoneId} (${zoneName})`);
      orphanCount++;
    }
  }
  return orphanCount;
}

export async function runOrphanedResourcesScan(
  region: string = DEFAULT_REGION
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-state-'));

  try {
    // Step 1: Download terraform state files
    logInfo(`Fetching terraform state files from s3://${STATE_BUCKET}...`);

    const stateKeysOutput = exec(
      `aws s3api list-objects-v2 --bucket "${STATE_BUCKET}" --query "Contents[?ends_with(Key, '.tfstate')].Key" --output text`
    );

    if (!stateKeysOutput.trim()) {
      console.error(`No state files found in s3://${STATE_BUCKET}`);
      process.exit(1);
    }

    const stateKeys = stateKeysOutput.trim().split(/\s+/).filter(Boolean);
    const managedResources = new Set<string>();

    // Download and parse each state file
    for (const key of stateKeys) {
      logInfo(`Processing state: ${key}`);
      const localFile = path.join(tempDir, key.replace(/\//g, '_'));
      exec(`aws s3 cp "s3://${STATE_BUCKET}/${key}" "${localFile}" --quiet`);

      const resources = extractManagedResources(localFile);
      for (const r of resources) {
        managedResources.add(r);
      }
    }

    logInfo(
      `Found ${managedResources.size} managed AWS resources in terraform state`
    );

    // Step 2: Scan for orphans
    console.log('');
    logInfo('Scanning AWS account for orphaned resources...');
    console.log('');

    let orphanCount = 0;
    orphanCount += checkS3Buckets(managedResources);
    orphanCount += checkEcrRepositories(managedResources, region);
    orphanCount += checkRdsInstances(managedResources, region);
    orphanCount += checkDynamoDbTables(managedResources, region);
    orphanCount += checkIamUsers(managedResources);
    orphanCount += checkIamRoles(managedResources);
    orphanCount += checkSecurityGroups(managedResources, region);
    orphanCount += checkRoute53Zones(managedResources);

    // Step 3: Summary
    console.log('');
    console.log('============================================');
    if (orphanCount === 0) {
      logSuccess('No orphaned AWS resources found!');
    } else {
      logWarn(
        `Found ${orphanCount} orphaned AWS resources not managed by Terraform`
      );
      console.log('');
      console.log(
        'These resources exist in AWS but are not in any terraform state file.'
      );
      console.log('Consider:');
      console.log(
        '  1. Importing them into terraform: terraform import <resource> <id>'
      );
      console.log('  2. Deleting them if no longer needed');
      console.log(
        '  3. Adding them to an ignore list if intentionally unmanaged'
      );
    }
    console.log('============================================');

    if (orphanCount > 0) {
      process.exit(orphanCount);
    }
  } finally {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
