# ── Archive sources ──────────────────────────────────────────────────────────
data "archive_file" "wake" {
  type        = "zip"
  source_dir  = "${path.module}/lambdas/wake"
  output_path = "${path.module}/lambdas/wake.zip"
}

data "archive_file" "shutdown" {
  type        = "zip"
  source_dir  = "${path.module}/lambdas/shutdown"
  output_path = "${path.module}/lambdas/shutdown.zip"
}

# ── IAM — Wake Lambda ─────────────────────────────────────────────────────────
resource "aws_iam_role" "wake_lambda" {
  name = "hq-dev-wake-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "wake_lambda_ec2" {
  name = "hq-dev-wake-ec2"
  role = aws_iam_role.wake_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ec2:DescribeInstances", "ec2:StartInstances"]
      Resource = "*"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "wake_lambda_logs" {
  role       = aws_iam_role.wake_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── IAM — Shutdown Lambda ─────────────────────────────────────────────────────
resource "aws_iam_role" "shutdown_lambda" {
  name = "hq-dev-shutdown-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "shutdown_lambda_ec2" {
  name = "hq-dev-shutdown-ec2"
  role = aws_iam_role.shutdown_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ec2:DescribeInstances", "ec2:StopInstances"]
      Resource = "*"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "shutdown_lambda_logs" {
  role       = aws_iam_role.shutdown_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ── Wake Lambda + Function URL ────────────────────────────────────────────────
resource "aws_lambda_function" "wake" {
  function_name    = "hq-dev-wake-ec2"
  role             = aws_iam_role.wake_lambda.arn
  runtime          = "python3.12"
  handler          = "index.handler"
  filename         = data.archive_file.wake.output_path
  source_code_hash = data.archive_file.wake.output_base64sha256

  environment {
    variables = {
      INSTANCE_ID = aws_instance.dev.id
    }
  }
}

resource "aws_lambda_function_url" "wake" {
  function_name      = aws_lambda_function.wake.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["https://HQv2.${var.cf_zone_name}"]
    allow_methods = ["GET", "POST"]
    allow_headers = ["content-type"]
  }
}

# ── Shutdown Lambda ───────────────────────────────────────────────────────────
resource "aws_lambda_function" "shutdown" {
  function_name    = "hq-dev-shutdown-ec2"
  role             = aws_iam_role.shutdown_lambda.arn
  runtime          = "python3.12"
  handler          = "index.handler"
  filename         = data.archive_file.shutdown.output_path
  source_code_hash = data.archive_file.shutdown.output_base64sha256

  environment {
    variables = {
      INSTANCE_ID = aws_instance.dev.id
    }
  }
}

# ── SNS → Shutdown Lambda ─────────────────────────────────────────────────────
resource "aws_sns_topic" "ec2_idle" {
  name = "hq-dev-ec2-idle"
}

resource "aws_sns_topic_subscription" "shutdown" {
  topic_arn = aws_sns_topic.ec2_idle.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.shutdown.arn
}

resource "aws_lambda_permission" "sns_shutdown" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.shutdown.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.ec2_idle.arn
}

# ── CloudWatch: auto-hibernate after 30 min idle ──────────────────────────────
resource "aws_cloudwatch_metric_alarm" "ec2_idle" {
  alarm_name          = "hq-dev-ec2-idle-30min"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 6
  metric_name         = "NetworkPacketsIn"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Sum"
  threshold           = 100

  dimensions = {
    InstanceId = aws_instance.dev.id
  }

  alarm_actions      = [aws_sns_topic.ec2_idle.arn]
  treat_missing_data = "notBreaching"
}
