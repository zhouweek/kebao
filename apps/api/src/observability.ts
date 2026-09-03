function label(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

export class HttpMetrics {
  private readonly startedAt = Date.now();
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, number>();

  observe(method: string, route: string, statusCode: number, durationMs: number): void {
    const key = `${method}\t${route}\t${statusCode}`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    this.durations.set(key, (this.durations.get(key) ?? 0) + durationMs / 1000);
  }

  render(): string {
    const lines = [
      "# HELP kebao_process_uptime_seconds API process uptime.",
      "# TYPE kebao_process_uptime_seconds gauge",
      `kebao_process_uptime_seconds ${(Date.now() - this.startedAt) / 1000}`,
      "# HELP kebao_http_requests_total HTTP requests by method, route and status.",
      "# TYPE kebao_http_requests_total counter",
    ];
    for (const [key, count] of this.requests) {
      const [method = "", route = "", status = ""] = key.split("\t");
      const labels = `method="${label(method)}",route="${label(route)}",status="${label(status)}"`;
      lines.push(`kebao_http_requests_total{${labels}} ${count}`);
    }
    lines.push(
      "# HELP kebao_http_request_duration_seconds_sum Total HTTP request duration.",
      "# TYPE kebao_http_request_duration_seconds_sum counter",
    );
    for (const [key, duration] of this.durations) {
      const [method = "", route = "", status = ""] = key.split("\t");
      const labels = `method="${label(method)}",route="${label(route)}",status="${label(status)}"`;
      lines.push(`kebao_http_request_duration_seconds_sum{${labels}} ${duration}`);
    }
    return `${lines.join("\n")}\n`;
  }
}
