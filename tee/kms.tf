data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "kms_key_policy" {
  statement {
    sid    = "RootAccountAccess"
    effect = "Allow"
    actions = [
      "kms:*"
    ]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  statement {
    sid    = "AllowParentRoleUse"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:Encrypt",
      "kms:GenerateDataKey",
      "kms:DescribeKey"
    ]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.enclave_host.arn]
    }
  }
}

resource "aws_kms_key" "tee" {
  description         = "KMS key for ${local.name_prefix} Nitro Enclave workflows"
  enable_key_rotation = true
  policy              = data.aws_iam_policy_document.kms_key_policy.json
  tags                = local.tags
}

resource "aws_kms_alias" "tee" {
  name          = "alias/${local.name_prefix}-tee"
  target_key_id = aws_kms_key.tee.id
}
