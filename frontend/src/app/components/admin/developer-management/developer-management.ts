
import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { WebService } from '../../../services/web-service';

@Component({
  selector: 'app-developer-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './developer-management.html',
  styleUrls: ['./developer-management.css']
})
export class DeveloperManagement {
  developers: any[] = [];
  allDevelopers: any[] = [];
  searchTerm: string = '';
  loading = false;
  error: string | null = null;
  renameMap: { [key: string]: string } = {};
  deletePending: string | null = null;

  // Pagination
  currentPage: number = 1;
  pageSize: number = 20;
  totalPages: number = 1;

  constructor(private webService: WebService, private cdr: ChangeDetectorRef) {
    this.loadDevelopers();
  }

  loadDevelopers() {
    this.loading = true;
    this.webService.getDevelopers().subscribe({
      next: (res) => {
        this.allDevelopers = res || [];
        this.applySearch();
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.error = err.error?.message || err.message || 'Failed to load developers.';
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  searchDevelopers() {
    this.applySearch();
  }

  applySearch() {
    const term = this.searchTerm.trim().toLowerCase();
    let filtered = this.allDevelopers;
    if (term) {
      filtered = filtered.filter(dev =>
        dev.developer && dev.developer.toLowerCase().includes(term)
      );
    }
    this.totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
    this.currentPage = Math.min(this.currentPage, this.totalPages);
    const startIdx = (this.currentPage - 1) * this.pageSize;
    this.developers = filtered.slice(startIdx, startIdx + this.pageSize);
    this.cdr.detectChanges();
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.applySearch();
  }

  startRename(dev: string) {
    this.renameMap[dev] = dev;
  }

  cancelRename(dev: string) {
    delete this.renameMap[dev];
  }

  confirmRename(dev: string) {
    const newName = this.renameMap[dev]?.trim();
    if (!newName || newName === dev) return;
    this.webService.renameDeveloper(dev, newName).subscribe({
      next: () => {
        this.loadDevelopers();
        delete this.renameMap[dev];
      },
      error: (err) => {
        this.error = err.error?.message || err.message || 'Rename failed.';
      }
    });
  }

  confirmDelete(dev: string) {
    this.deletePending = dev;
  }

  deleteDeveloper(dev: string) {
    this.webService.deleteDeveloper(dev).subscribe({
      next: () => {
        this.loadDevelopers();
        this.deletePending = null;
      },
      error: (err) => {
        this.error = err.error?.message || err.message || 'Delete failed.';
      }
    });
  }
}
