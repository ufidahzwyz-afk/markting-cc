locals {
  prefix = "boran-${var.environment}"
  services = toset(["compute.googleapis.com", "run.googleapis.com", "sqladmin.googleapis.com", "servicenetworking.googleapis.com", "cloudtasks.googleapis.com", "cloudscheduler.googleapis.com", "secretmanager.googleapis.com", "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com", "artifactregistry.googleapis.com"])
  actors = toset(["ops", "public", "worker", "browser", "tasks", "scheduler", "deploy"])
  app_services = { ops = var.images.ops, public = var.images.public_site, worker = var.images.worker }
  secrets = toset(["ops-db-url", "public-db-url", "worker-db-url", "session-cookie", "platform-credentials"])
}
resource "google_project_service" "apis" { for_each = local.services
 service = each.key
 disable_on_destroy = false }
resource "google_service_account" "actors" { for_each = local.actors
 account_id = "${local.prefix}-${each.key}"
 display_name = "Boran ${var.environment} ${each.key}" }
resource "google_compute_network" "private" { name = "${local.prefix}-private"
 auto_create_subnetworks = false
 depends_on = [google_project_service.apis] }
resource "google_compute_subnetwork" "private" { name = "${local.prefix}-private"
 ip_cidr_range = "10.42.0.0/24"
 region = var.region
 network = google_compute_network.private.id
 private_ip_google_access = true }
resource "google_compute_global_address" "sql_range" { name = "${local.prefix}-sql"
 purpose = "VPC_PEERING"
 address_type = "INTERNAL"
 prefix_length = 16
 network = google_compute_network.private.id }
resource "google_service_networking_connection" "sql" { network = google_compute_network.private.id
 service = "servicenetworking.googleapis.com"
 reserved_peering_ranges = [google_compute_global_address.sql_range.name] }
resource "google_sql_database_instance" "postgres" {
  name = "${local.prefix}-postgres"
  database_version = "POSTGRES_17"
  region = var.region
  deletion_protection = true
  settings {
    tier = var.database_tier
    availability_type = "ZONAL"
    disk_type = "PD_SSD"
    disk_size = 20
    backup_configuration { enabled = true
 point_in_time_recovery_enabled = true
 start_time = "18:00"
 transaction_log_retention_days = 7 }
    ip_configuration { ipv4_enabled = false
 private_network = google_compute_network.private.id }
    database_flags { name = "max_connections"
 value = "50" }
    database_flags { name = "cloudsql.iam_authentication"
 value = "on" }
  }
  depends_on = [google_service_networking_connection.sql]
}
resource "google_sql_database" "app" { name = "boran"
 instance = google_sql_database_instance.postgres.name }
resource "google_sql_user" "apps" {
  for_each = toset(["ops", "public", "worker"])
  name = trimsuffix(google_service_account.actors[each.key].email, ".gserviceaccount.com")
  instance = google_sql_database_instance.postgres.name
  type = "CLOUD_IAM_SERVICE_ACCOUNT"
}
resource "google_project_iam_member" "sql_client" { for_each = toset(["ops", "public", "worker"])
 role = "roles/cloudsql.client"
 member = "serviceAccount:${google_service_account.actors[each.key].email}" }
resource "google_project_iam_member" "sql_login" { for_each = toset(["ops", "public", "worker"])
 role = "roles/cloudsql.instanceUser"
 member = "serviceAccount:${google_service_account.actors[each.key].email}" }
resource "google_secret_manager_secret" "configuration" {
  for_each = local.secrets
  secret_id = "${local.prefix}-${each.key}"
  replication { auto {} }
  depends_on = [google_project_service.apis]
}
resource "google_secret_manager_secret_iam_member" "database" { for_each = local.app_services
 secret_id = google_secret_manager_secret.configuration["${each.key}-db-url"].id
 role = "roles/secretmanager.secretAccessor"
 member = "serviceAccount:${google_service_account.actors[each.key].email}" }
resource "google_secret_manager_secret_iam_member" "cookie" { secret_id = google_secret_manager_secret.configuration["session-cookie"].id
 role = "roles/secretmanager.secretAccessor"
 member = "serviceAccount:${google_service_account.actors["ops"].email}" }
resource "google_secret_manager_secret_iam_member" "platform" { secret_id = google_secret_manager_secret.configuration["platform-credentials"].id
 role = "roles/secretmanager.secretAccessor"
 member = "serviceAccount:${google_service_account.actors["worker"].email}" }
resource "google_storage_bucket" "media" { name = "${var.project_id}-${local.prefix}-media"
 location = var.region
 uniform_bucket_level_access = true
 public_access_prevention = "enforced"
 versioning { enabled = true }
 force_destroy = false }
resource "google_storage_bucket" "profiles" { name = "${var.project_id}-${local.prefix}-sessions"
 location = var.region
 uniform_bucket_level_access = true
 public_access_prevention = "enforced"
 versioning { enabled = true }
 force_destroy = false }
resource "google_storage_bucket_iam_member" "media_read" { bucket = google_storage_bucket.media.name
 role = "roles/storage.objectViewer"
 member = "serviceAccount:${google_service_account.actors["public"].email}" }
resource "google_storage_bucket_iam_member" "media_write" { for_each = toset(["ops", "worker"])
 bucket = google_storage_bucket.media.name
 role = "roles/storage.objectCreator"
 member = "serviceAccount:${google_service_account.actors[each.key].email}" }
resource "google_storage_bucket_iam_member" "profile_backup" { bucket = google_storage_bucket.profiles.name
 role = "roles/storage.objectAdmin"
 member = "serviceAccount:${google_service_account.actors["browser"].email}" }
resource "google_cloud_run_v2_service" "apps" {
  for_each = local.app_services
  name = "${local.prefix}-${each.key}"
  location = var.region
  ingress = each.key == "public" && var.allow_public_site ? "INGRESS_TRAFFIC_ALL" : "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = true
  template {
    service_account = google_service_account.actors[each.key].email
    scaling { min_instance_count = 0
 max_instance_count = 1 }
    vpc_access { egress = "PRIVATE_RANGES_ONLY"
 network_interfaces { network = google_compute_network.private.name
 subnetwork = google_compute_subnetwork.private.name } }
    containers {
      image = each.value
      ports { container_port = each.key == "ops" ? 3000 : each.key == "public" ? 3001 : 3002 }
      resources { limits = { cpu = "1", memory = "512Mi" } }
      env { name = "APP_ENV"
 value = "production" }
      env { name = "AUTH_MODE"
 value = "oidc" }
      env { name = "BORAN_MODE"
 value = "live" }
      env { name = "WORKER_PORT"
 value = "3002" }
      env { name = "WRITE_ENABLED"
 value = "false" }
      env { name = "ADS_WRITE_ENABLED"
 value = "false" }
      env { name = "PUBLISH_ENABLED"
 value = "false" }
      env { name = "DATABASE_URL"
 value_source { secret_key_ref { secret = google_secret_manager_secret.configuration["${each.key}-db-url"].secret_id
 version = "1" } } }
    }
  }
}
resource "google_cloud_run_v2_service_iam_member" "public" { count = var.allow_public_site ? 1 : 0
 name = google_cloud_run_v2_service.apps["public"].name
 location = var.region
 role = "roles/run.invoker"
 member = "allUsers" }
resource "google_cloud_run_v2_service_iam_member" "worker" { for_each = toset(["tasks", "scheduler"])
 name = google_cloud_run_v2_service.apps["worker"].name
 location = var.region
 role = "roles/run.invoker"
 member = "serviceAccount:${google_service_account.actors[each.key].email}" }
resource "google_cloud_run_v2_job" "worker" {
  name = "${local.prefix}-worker-job"
  location = var.region
  deletion_protection = true
  template { template {
    service_account = google_service_account.actors["worker"].email
    timeout = "5400s"
    max_retries = 0
    vpc_access { egress = "PRIVATE_RANGES_ONLY"
 network_interfaces { network = google_compute_network.private.name
 subnetwork = google_compute_subnetwork.private.name } }
    containers { image = var.images.worker
 command = ["node", "--import", "tsx", "apps/worker/src/job.ts"]
 env { name = "BORAN_MODE"
 value = "live" }
 env { name = "DATABASE_URL"
 value_source { secret_key_ref { secret = google_secret_manager_secret.configuration["worker-db-url"].secret_id
 version = "1" } } } }
  } }
}
resource "google_cloud_run_v2_job_iam_member" "worker" { name = google_cloud_run_v2_job.worker.name
 location = var.region
 role = "roles/run.jobsExecutor"
 member = "serviceAccount:${google_service_account.actors["scheduler"].email}" }
resource "google_cloud_tasks_queue" "jobs" { name = "${local.prefix}-tasks"
 location = var.region
 rate_limits { max_concurrent_dispatches = 2
 max_dispatches_per_second = 2 }
 retry_config { max_attempts = 1 } }
resource "google_project_iam_member" "enqueue" { role = "roles/cloudtasks.enqueuer"
 member = "serviceAccount:${google_service_account.actors["worker"].email}" }
resource "google_cloud_scheduler_job" "dispatch" {
  name = "${local.prefix}-dispatch"
  region = var.region
  schedule = "* * * * *"
  time_zone = "Asia/Shanghai"
  http_target {
    uri = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.worker.name}:run"
    http_method = "POST"
    body = base64encode(jsonencode({}))
    headers = { "Content-Type" = "application/json" }
    oauth_token {
      service_account_email = google_service_account.actors["scheduler"].email
      scope = "https://www.googleapis.com/auth/cloud-platform"
    }
  }
}
resource "google_compute_disk" "profiles" { name = "${local.prefix}-browser-profiles"
 zone = var.zone
 type = "pd-balanced"
 size = 20
 lifecycle { prevent_destroy = true } }
resource "google_compute_resource_policy" "backups" { name = "${local.prefix}-profile-backups"
 region = var.region
 snapshot_schedule_policy { schedule { daily_schedule { days_in_cycle = 1
 start_time = "18:00" } }
 retention_policy { max_retention_days = 7
 on_source_disk_delete = "KEEP_AUTO_SNAPSHOTS" }
 snapshot_properties { storage_locations = [var.region] } } }
resource "google_compute_disk_resource_policy_attachment" "backup" { name = google_compute_resource_policy.backups.name
 disk = google_compute_disk.profiles.name
 zone = var.zone }
resource "google_compute_instance" "browser" {
  name = "${local.prefix}-browser"
  zone = var.zone
  machine_type = var.browser_machine_type
  boot_disk { initialize_params { image = var.browser_boot_image
 size = 20 } }
  attached_disk { source = google_compute_disk.profiles.id
 device_name = "browser-profiles" }
  network_interface { subnetwork = google_compute_subnetwork.private.id }
  service_account { email = google_service_account.actors["browser"].email
 scopes = ["cloud-platform"] }
  tags = ["${local.prefix}-browser"]
  shielded_instance_config { enable_secure_boot = true
 enable_vtpm = true
 enable_integrity_monitoring = true }
  metadata = { enable-oslogin = "TRUE", block-project-ssh-keys = "TRUE" }
  metadata_startup_script = templatefile("${path.module}/browser-startup.sh.tftpl", { image = var.images.browser
 org_id = var.org_id
 worker_email = google_service_account.actors["worker"].email })
}
resource "google_compute_firewall" "browser" { name = "${local.prefix}-browser-private"
 network = google_compute_network.private.name
 source_ranges = [google_compute_subnetwork.private.ip_cidr_range]
 target_tags = ["${local.prefix}-browser"]
 allow { protocol = "tcp"
 ports = ["3003"] } }
resource "google_iam_workload_identity_pool" "github" { workload_identity_pool_id = "${local.prefix}-github" }
resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  attribute_mapping = { "google.subject" = "assertion.sub", "attribute.repository" = "assertion.repository" }
  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.ref == 'refs/heads/main'"
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}
resource "google_service_account_iam_member" "github" { service_account_id = google_service_account.actors["deploy"].name
 role = "roles/iam.workloadIdentityUser"
 member = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}" }
