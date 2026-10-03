output "cloud_run_urls" { value = { for name, service in google_cloud_run_v2_service.apps : name => service.uri } }
output "sql_connection_name" { value = google_sql_database_instance.postgres.connection_name }
output "browser_private_address" { value = google_compute_instance.browser.network_interface[0].network_ip }
output "github_wif_provider" { value = google_iam_workload_identity_pool_provider.github.name }
output "readiness" { value = "Plan only: secrets, DB grants, browser command DB gateway, egress, auth, adapters and cost approval require integration; no resources have been applied." }
