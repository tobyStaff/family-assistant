// src/templates/childProfilesContent.ts

/**
 * Generate the child profiles content HTML (without layout wrapper)
 */
export function renderChildProfilesContent(): string {
  return `
    <style>
      .toolbar {
        background: white;
        padding: 20px;
        border-radius: 12px;
        margin-bottom: 20px;
        display: flex;
        gap: 15px;
        flex-wrap: wrap;
        align-items: center;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }

      .filter-group {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-left: auto;
      }

      .filter-btn {
        padding: 8px 16px;
        border: 2px solid var(--primary-color);
        background: white;
        color: var(--primary-color);
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s;
      }

      .filter-btn:hover {
        background: #f5f7ff;
      }

      .filter-btn.active {
        background: var(--primary-color);
        color: white;
      }

      .profiles-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 20px;
      }

      .profile-card {
        background: white;
        padding: 24px;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .profile-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
      }

      .profile-card.inactive {
        opacity: 0.6;
      }

      .profile-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 16px;
      }

      .profile-name {
        font-size: 20px;
        font-weight: 600;
        color: #333;
        margin-bottom: 4px;
      }

      .profile-alias {
        font-size: 14px;
        color: #666;
        font-style: italic;
      }

      .status-badge {
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
      }

      .status-active {
        background: #d4edda;
        color: #155724;
      }

      .status-inactive {
        background: #f8d7da;
        color: #721c24;
      }

      .profile-details {
        margin: 16px 0;
      }

      .profile-detail {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        font-size: 14px;
        color: #555;
      }

      .profile-detail-icon {
        font-size: 16px;
      }

      .profile-notes {
        background: #f8f9fa;
        padding: 12px;
        border-radius: 8px;
        font-size: 13px;
        color: #666;
        margin-top: 16px;
        font-style: italic;
      }

      .profile-actions {
        display: flex;
        gap: 8px;
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid #e0e0e0;
      }

      .btn-small {
        flex: 1;
        padding: 10px 16px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .btn-edit {
        background: var(--primary-color);
        color: white;
      }

      .btn-edit:hover {
        background: var(--primary-dark);
      }

      .btn-delete {
        background: var(--danger-color);
        color: white;
      }

      .btn-delete:hover {
        background: #c82333;
      }

      .empty-state {
        background: white;
        padding: 60px 20px;
        border-radius: 12px;
        text-align: center;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      }

      .empty-state-icon {
        font-size: 64px;
        margin-bottom: 16px;
      }

      .empty-state h2 {
        font-size: 24px;
        color: #333;
        margin-bottom: 8px;
      }

      .empty-state p {
        color: #666;
        margin-bottom: 20px;
      }

      /* Modal styles */
      .modal {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 1000;
        align-items: center;
        justify-content: center;
      }

      .modal.active {
        display: flex;
      }

      .modal-content {
        background: white;
        padding: 32px;
        border-radius: 12px;
        max-width: 500px;
        width: 90%;
        max-height: 90vh;
        overflow-y: auto;
      }

      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;
      }

      .modal-header h2 {
        font-size: 20px;
        color: #333;
      }

      .close-btn {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #999;
      }

      .close-btn:hover {
        color: #333;
      }

      .form-group {
        margin-bottom: 20px;
      }

      .form-group label {
        display: block;
        font-weight: 600;
        margin-bottom: 8px;
        color: #333;
      }

      .form-group input,
      .form-group textarea {
        width: 100%;
        padding: 12px;
        border: 2px solid #e0e0e0;
        border-radius: 8px;
        font-size: 14px;
        font-family: inherit;
        transition: border-color 0.2s;
      }

      .form-group input:focus,
      .form-group textarea:focus {
        outline: none;
        border-color: var(--primary-color);
      }

      .form-group textarea {
        resize: vertical;
        min-height: 80px;
      }

      .form-group small {
        display: block;
        margin-top: 4px;
        color: #888;
        font-size: 12px;
      }

      .checkbox-group {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .checkbox-group input[type="checkbox"] {
        width: 18px;
        height: 18px;
      }

      .modal-actions {
        display: flex;
        gap: 12px;
        margin-top: 24px;
      }

      .message {
        padding: 16px;
        border-radius: 8px;
        margin-bottom: 20px;
        font-size: 14px;
        display: none;
      }

      .message.success {
        background: #d4edda;
        border: 1px solid #c3e6cb;
        color: #155724;
        display: block;
      }

      .message.error {
        background: #f8d7da;
        border: 1px solid #f5c6cb;
        color: #721c24;
        display: block;
      }

      .loading {
        text-align: center;
        padding: 40px;
        color: #666;
        font-size: 16px;
      }
    </style>

    <div id="message" class="message"></div>

    <div class="toolbar">
      <button class="btn btn-primary" onclick="addChildManually()">
        ➕ Add Child Manually
      </button>
      <a href="/onboarding" class="btn btn-outline">
        🔍 Run Analysis Again
      </a>
      <div class="filter-group">
        <span style="font-size: 14px; color: #666;">Show:</span>
        <button class="filter-btn active" onclick="filterProfiles('all')">All</button>
        <button class="filter-btn" onclick="filterProfiles('active')">Active</button>
        <button class="filter-btn" onclick="filterProfiles('inactive')">Inactive</button>
      </div>
    </div>

    <div id="loading" class="loading" style="display: none;">
      Loading profiles...
    </div>

    <div id="profiles-container"></div>

    <!-- Edit Modal -->
    <div id="edit-modal" class="modal">
      <div class="modal-content">
        <div class="modal-header">
          <h2 id="modal-title">Edit Child Profile</h2>
          <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>

        <form id="edit-form" onsubmit="saveProfile(event)">
          <input type="hidden" id="edit-profile-id">

          <div class="form-group">
            <label for="edit-real-name">Real Name *</label>
            <input type="text" id="edit-real-name" required>
            <small>Actual name from school emails</small>
          </div>

          <div class="form-group">
            <label for="edit-display-name">Display Name (Privacy Alias)</label>
            <input type="text" id="edit-display-name">
            <small>Optional: Use an alias like "Child A" for privacy in sent emails</small>
          </div>

          <div class="form-group">
            <label for="edit-year-group">Year Group</label>
            <input type="text" id="edit-year-group" placeholder="e.g., Year 3, Reception">
          </div>

          <div class="form-group">
            <label for="edit-school-name">School Name</label>
            <input type="text" id="edit-school-name" placeholder="e.g., St Mary's Primary">
          </div>

          <div class="form-group">
            <label for="edit-class-name">Class Name</label>
            <input type="text" id="edit-class-name" placeholder="e.g., Elm, Lime, Beech">
            <small>Helps match class-specific events like "Elm Woodland School"</small>
          </div>

          <div class="form-group">
            <label for="edit-clubs">Clubs (comma separated)</label>
            <input type="text" id="edit-clubs" placeholder="e.g., Rocksteady, Swimming, Football">
            <small>Helps match club-specific events like "Rocksteady Concert"</small>
          </div>

          <div class="form-group">
            <label for="edit-notes">Notes</label>
            <textarea id="edit-notes" placeholder="Any additional notes..."></textarea>
          </div>

          <div class="form-group">
            <div class="checkbox-group">
              <input type="checkbox" id="edit-is-active" checked>
              <label for="edit-is-active" style="margin-bottom: 0;">Active enrollment</label>
            </div>
            <small>Uncheck if child has graduated or left the school</small>
          </div>

          <div class="modal-actions">
            <button type="submit" class="btn btn-primary" style="flex: 1;">Save Changes</button>
            <button type="button" class="btn btn-outline" onclick="closeModal()" style="flex: 1;">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

/**
 * Generate the child profiles JavaScript
 */
export function renderChildProfilesScripts(): string {
  return `
    <script>
      let profiles = [];
      let currentFilter = 'all';
      let editingProfileId = null;

      // Load profiles on page load
      async function loadProfiles() {
        const loadingDiv = document.getElementById('loading');
        const container = document.getElementById('profiles-container');

        loadingDiv.style.display = 'block';
        container.innerHTML = '';

        try {
          const response = await fetch('/child-profiles');
          if (!response.ok) {
            throw new Error('Failed to load profiles');
          }

          const data = await response.json();
          profiles = data.profiles || [];

          renderProfiles();
        } catch (error) {
          showMessage('error', 'Failed to load profiles: ' + error.message);
        } finally {
          loadingDiv.style.display = 'none';
        }
      }

      function renderProfiles() {
        const container = document.getElementById('profiles-container');

        // Filter profiles based on current filter
        let filteredProfiles = profiles;
        if (currentFilter === 'active') {
          filteredProfiles = profiles.filter(p => p.is_active);
        } else if (currentFilter === 'inactive') {
          filteredProfiles = profiles.filter(p => !p.is_active);
        }

        if (filteredProfiles.length === 0) {
          container.innerHTML = \`
            <div class="empty-state">
              <div class="empty-state-icon">👶</div>
              <h2>No child profiles found</h2>
              <p>Get started by running an analysis on your school emails or adding a child manually.</p>
              <a href="/onboarding" class="btn btn-primary">🔍 Run Analysis</a>
            </div>
          \`;
          return;
        }

        container.innerHTML = '<div class="profiles-grid">' +
          filteredProfiles.map(profile => \`
            <div class="profile-card \${profile.is_active ? '' : 'inactive'}">
              <div class="profile-header">
                <div>
                  <div class="profile-name">\${escapeHtml(profile.real_name)}</div>
                  \${profile.display_name ? \`<div class="profile-alias">Alias: \${escapeHtml(profile.display_name)}</div>\` : ''}
                </div>
                <span class="status-badge \${profile.is_active ? 'status-active' : 'status-inactive'}">
                  \${profile.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div class="profile-details">
                \${profile.year_group ? \`
                  <div class="profile-detail">
                    <span class="profile-detail-icon">📚</span>
                    <span>\${escapeHtml(profile.year_group)}</span>
                  </div>
                \` : ''}
                \${profile.school_name ? \`
                  <div class="profile-detail">
                    <span class="profile-detail-icon">🏫</span>
                    <span>\${escapeHtml(profile.school_name)}</span>
                  </div>
                \` : ''}
                \${profile.class_name ? \`
                  <div class="profile-detail">
                    <span class="profile-detail-icon">🎓</span>
                    <span>Class: \${escapeHtml(profile.class_name)}</span>
                  </div>
                \` : ''}
                \${profile.clubs && profile.clubs.length > 0 ? \`
                  <div class="profile-detail">
                    <span class="profile-detail-icon">⚽</span>
                    <span>Clubs: \${profile.clubs.map(c => escapeHtml(c)).join(', ')}</span>
                  </div>
                \` : ''}
                \${profile.confidence_score !== null && profile.confidence_score !== undefined ? \`
                  <div class="profile-detail">
                    <span class="profile-detail-icon">🎯</span>
                    <span>Confidence: \${Math.round(profile.confidence_score * 100)}%</span>
                  </div>
                \` : ''}
              </div>

              \${profile.notes ? \`
                <div class="profile-notes">
                  📝 \${escapeHtml(profile.notes)}
                </div>
              \` : ''}

              <div class="profile-actions">
                <button class="btn-small btn-edit" onclick="editProfile(\${profile.id})">
                  ✏️ Edit
                </button>
                <button class="btn-small btn-delete" onclick="deleteProfile(\${profile.id}, '\${escapeHtml(profile.real_name).replace(/'/g, "\\\\'")}')">
                  🗑️ Delete
                </button>
              </div>
            </div>
          \`).join('') +
          '</div>';
      }

      function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      function filterProfiles(filter) {
        currentFilter = filter;

        // Update button states
        document.querySelectorAll('.filter-btn').forEach(btn => {
          btn.classList.remove('active');
        });
        event.target.classList.add('active');

        renderProfiles();
      }

      function addChildManually() {
        editingProfileId = null;
        document.getElementById('modal-title').textContent = 'Add Child Manually';
        document.getElementById('edit-form').reset();
        document.getElementById('edit-profile-id').value = '';
        document.getElementById('edit-is-active').checked = true;
        document.getElementById('edit-modal').classList.add('active');
      }

      function editProfile(profileId) {
        const profile = profiles.find(p => p.id === profileId);
        if (!profile) return;

        editingProfileId = profileId;
        document.getElementById('modal-title').textContent = 'Edit Child Profile';
        document.getElementById('edit-profile-id').value = profileId;
        document.getElementById('edit-real-name').value = profile.real_name || '';
        document.getElementById('edit-display-name').value = profile.display_name || '';
        document.getElementById('edit-year-group').value = profile.year_group || '';
        document.getElementById('edit-school-name').value = profile.school_name || '';
        document.getElementById('edit-class-name').value = profile.class_name || '';
        document.getElementById('edit-clubs').value = (profile.clubs || []).join(', ');
        document.getElementById('edit-notes').value = profile.notes || '';
        document.getElementById('edit-is-active').checked = profile.is_active;
        document.getElementById('edit-modal').classList.add('active');
      }

      function closeModal() {
        document.getElementById('edit-modal').classList.remove('active');
        editingProfileId = null;
      }

      async function saveProfile(event) {
        event.preventDefault();

        const profileId = document.getElementById('edit-profile-id').value;
        const clubsInput = document.getElementById('edit-clubs').value.trim();
        const clubs = clubsInput ? clubsInput.split(',').map(c => c.trim()).filter(c => c) : [];
        const data = {
          real_name: document.getElementById('edit-real-name').value.trim(),
          display_name: document.getElementById('edit-display-name').value.trim() || undefined,
          year_group: document.getElementById('edit-year-group').value.trim() || undefined,
          school_name: document.getElementById('edit-school-name').value.trim() || undefined,
          class_name: document.getElementById('edit-class-name').value.trim() || undefined,
          clubs: clubs.length > 0 ? clubs : undefined,
          notes: document.getElementById('edit-notes').value.trim() || undefined,
          is_active: document.getElementById('edit-is-active').checked,
        };

        try {
          let response;
          if (profileId) {
            // Update existing profile
            response = await fetch('/child-profiles/' + profileId, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            });
          } else {
            // Create new profile
            const createData = {
              profiles: [{
                ...data,
                display_name: data.display_name || '',
                year_group: data.year_group || '',
                school_name: data.school_name || '',
                class_name: data.class_name || '',
                clubs: data.clubs || [],
                notes: data.notes || ''
              }]
            };
            response = await fetch('/onboarding/confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(createData)
            });
          }

          if (!response.ok) {
            throw new Error('Failed to save profile');
          }

          showMessage('success', profileId ? 'Profile updated successfully!' : 'Child profile created successfully!');
          closeModal();
          await loadProfiles();
        } catch (error) {
          showMessage('error', 'Failed to save profile: ' + error.message);
        }
      }

      async function deleteProfile(profileId, childName) {
        if (!confirm('Are you sure you want to delete the profile for "' + childName + '"? This action cannot be undone.')) {
          return;
        }

        try {
          const response = await fetch('/child-profiles/' + profileId, {
            method: 'DELETE'
          });

          if (!response.ok) {
            throw new Error('Failed to delete profile');
          }

          showMessage('success', 'Profile deleted successfully');
          await loadProfiles();
        } catch (error) {
          showMessage('error', 'Failed to delete profile: ' + error.message);
        }
      }

      function showMessage(type, text) {
        const messageDiv = document.getElementById('message');
        messageDiv.className = 'message ' + type;
        messageDiv.textContent = text;
        messageDiv.style.display = 'block';

        setTimeout(() => {
          messageDiv.style.display = 'none';
        }, 5000);
      }

      // Close modal when clicking outside
      document.getElementById('edit-modal').addEventListener('click', function(e) {
        if (e.target === this) {
          closeModal();
        }
      });

      // Load profiles when page loads
      loadProfiles();
    </script>
  `;
}
