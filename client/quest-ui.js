/**
 * Trailtale Quest UI
 * Handles quest list display, found/expired state, and photo capture.
 */

class QuestUI {
  constructor(containerEl) {
    this.container = containerEl;
    this.quests = [];
    this.finds = new Set();
  }

  /**
   * Set the quest list and render it.
   */
  setQuests(quests) {
    this.quests = quests;
    this.render();
  }

  /**
   * Mark a quest as found.
   */
  markFound(questId, confirmed = false) {
    this.finds.add(questId);
    this.render();
    // Haptic feedback if confirmed
    if (confirmed && navigator.vibrate) {
      navigator.vibrate(200);
    }
  }

  /**
   * Render the quest list into the container.
   */
  render() {
    if (!this.container) return;

    const today = new Date().toISOString().slice(0, 10);

    const active = this.quests.filter(q => q.starts <= today && q.expires >= today);
    const expired = this.quests.filter(q => q.expires < today);

    let html = '';

    if (active.length > 0) {
      html += '<div class="quest-section"><h3 class="quest-heading">This Week\'s Quests</h3><ul class="quest-list">';
      for (const q of active) {
        const found = this.finds.has(q.id);
        const cls = found ? 'quest-item quest-found' : 'quest-item';
        const icon = found ? '✅' : '🔍';
        html += `
          <li class="${cls}" data-quest-id="${q.id}">
            <span class="quest-icon">${icon}</span>
            <div class="quest-info">
              <span class="quest-title">${q.title}</span>
              <span class="quest-hint">${q.hint}</span>
              <span class="quest-expiry">Expires ${q.expires}</span>
            </div>
            ${!found ? `<button class="quest-photo-btn" onclick="window.trailtaleApp.captureQuestPhoto('${q.id}')" title="Take photo">📷</button>` : ''}
          </li>`;
      }
      html += '</ul></div>';
    }

    if (expired.length > 0) {
      html += '<div class="quest-section quest-history"><h3 class="quest-heading">Past Quests</h3><ul class="quest-list">';
      for (const q of expired) {
        html += `
          <li class="quest-item quest-expired">
            <span class="quest-icon">⏳</span>
            <div class="quest-info">
              <span class="quest-title">${q.title}</span>
            </div>
          </li>`;
      }
      html += '</ul></div>';
    }

    this.container.innerHTML = html;
  }
}

window.QuestUI = QuestUI;
