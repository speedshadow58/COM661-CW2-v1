import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-playtime-chart',
  standalone: true,
  template: `
    <div class="row g-3">
      <div class="col-md-8">
        <div class="card mb-4 shadow-sm">
          <div class="card-header bg-primary text-white">
            <h5 class="mb-0">Playtime Stats</h5>
          </div>
          <div class="card-body">
            <div class="row text-center">
              <div class="col">
                <span class="fw-bold">Avg Forever</span><br>
                <span class="badge bg-primary">{{ playtime?.average_playtime_forever ?? 0 }} min</span>
              </div>
              <div class="col">
                <span class="fw-bold">Avg 2 Weeks</span><br>
                <span class="badge bg-success">{{ playtime?.average_playtime_2weeks ?? 0 }} min</span>
              </div>
              <div class="col">
                <span class="fw-bold">Median Forever</span><br>
                <span class="badge bg-secondary">{{ playtime?.median_playtime_forever ?? 0 }} min</span>
              </div>
              <div class="col">
                <span class="fw-bold">Median 2 Weeks</span><br>
                <span class="badge bg-warning text-dark">{{ playtime?.median_playtime_2weeks ?? 0 }} min</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card mb-4 shadow-sm">
          <div class="card-header bg-info text-white">
            <h5 class="mb-0">Peak CCU</h5>
          </div>
          <div class="card-body text-center">
            <span class="display-6 fw-bold text-info">{{ playtime?.peak_ccu ?? 0 }}</span>
            <div class="text-muted">Peak Concurrent Users</div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class PlaytimeChartComponent {
  @Input() playtime: any;
}
