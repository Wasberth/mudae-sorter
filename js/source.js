(() => {
  const state = {
    characters: new Map(),
    unsorted: [],
    buckets: []
  };

  const storageKey = 'mudae-harem-sorter-state';
  const autosaveIntervalMs = 5 * 60 * 1000;

  const el = id => document.getElementById(id);
  const sourceText = el('sourceText');
  const parseStatus = el('parseStatus');
  const unsortedEl = el('unsorted');
  const bucketsEl = el('buckets');

  function saveState(manual = false) {
    syncStateFromDOM();
    const savedState = {
      characters: [...state.characters.values()],
      unsorted: state.unsorted,
      buckets: state.buckets
    };

    try {
      localStorage.setItem(storageKey, JSON.stringify(savedState));
      if (manual) {
        const saveButton = el('saveBtn');
        saveButton.textContent = 'Saved!';
        setTimeout(() => saveButton.textContent = 'Save', 1000);
      }
    } catch {
      if (manual) alert('Unable to save the current sort in this browser.');
    }
  }

  function loadState() {
    try {
      const savedState = JSON.parse(localStorage.getItem(storageKey));
      if (!savedState || !Array.isArray(savedState.characters) || !Array.isArray(savedState.buckets)) return false;

      state.characters = new Map(savedState.characters.map(character => [character.id, character]));
      const characterIds = new Set(state.characters.keys());
      state.unsorted = (Array.isArray(savedState.unsorted) ? savedState.unsorted : [])
        .filter(id => characterIds.has(id));
      state.buckets = savedState.buckets.map(bucket => ({
        id: bucket.id || uid(),
        name: typeof bucket.name === 'string' ? bucket.name : 'Bucket',
        chars: (Array.isArray(bucket.chars) ? bucket.chars : []).filter(id => characterIds.has(id))
      }));
      return true;
    } catch {
      localStorage.removeItem(storageKey);
      return false;
    }
  }

  let sortableInstances = [];

  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

  function normalizeUrl(url) {
    return url
      .replace(/\\~/g, '~')
      .replace(/[)"'\]\s]+$/g, '')
      .trim();
  }

  function parseCharacters(text) {
    const entryRe = /(?:^|\s)(.+?)\s+\*{0,2}(\d[\d,\.\s]+)\*{0,2}\s+ka\s*-\s*([\s\S]*?)(?=(?:\s+.+?\s+\*{0,2}[\d,\.\s]+\*{0,2}\s+ka\s*-)|$)/gi;
    const urlRe = /https:\/\/mudae\.net\/uploads\/[^\s)\]"']+/i;
    const found = [];
    let match;

    while ((match = entryRe.exec(text)) !== null) {
      const name = match[1].trim().replace(/^[)\]"]+/, '').trim();
      const value = Number(match[2].replace(/[,\.\s]/g, ''));
      const urlMatch = match[3].match(urlRe);

      if (!name || !Number.isFinite(value) || !urlMatch) continue;
      found.push({ id: uid(), name, value, image: normalizeUrl(urlMatch[0]) });
    }

    return found;
  }

  function hasName(name) {
    const n = name.trim().toLocaleLowerCase();
    for (const c of state.characters.values()) {
      if (c.name.trim().toLocaleLowerCase() === n) return true;
    }
    return false;
  }

  function addParsed(text) {
    const parsed = parseCharacters(text);
    let added = 0, duplicates = 0;

    for (const c of parsed) {
      if (hasName(c.name)) {
        duplicates++;
        continue;
      }
      state.characters.set(c.id, c);
      state.unsorted.push(c.id);
      added++;
    }

    render();
    saveState();
    if (!parsed.length) {
      parseStatus.className = 'status bad';
      parseStatus.textContent = 'No valid entries found. Expected: Name **1,234** ka - image URL';
    } else {
      parseStatus.className = 'status good';
      parseStatus.textContent = `Found ${parsed.length}; added ${added}${duplicates ? `; ignored ${duplicates} duplicate(s)` : ''}.`;
    }
  }

  function getChar(id) {
    return state.characters.get(id);
  }

  // Throttled image loader.
  const imageLoader = {
    queue: [],
    queued: new Set(),
    active: 0,
    maxConcurrent: 3,
    delayMs: 150,
    loaded: new Set(),
    failed: new Set(),
    timer: null,
    observer: null,

    enqueue(img) {
      const url = img.dataset.src;
      if (!url || this.loaded.has(url) || this.failed.has(url)) return;
      if (this.queued.has(img)) return;

      this.queued.add(img);
      this.queue.push(img);
      this.pump();
    },

    pump() {
      if (this.timer || this.active >= this.maxConcurrent || !this.queue.length) return;

      this.timer = setTimeout(() => {
        this.timer = null;

        while (this.active < this.maxConcurrent && this.queue.length) {
          const img = this.queue.shift();
          this.queued.delete(img);

          if (!document.documentElement.contains(img)) continue;

          const url = img.dataset.src;
          if (!url || this.loaded.has(url) || this.failed.has(url)) continue;

          this.active++;
          img.dataset.loading = 'true';

          const done = () => {
            this.active--;
            img.dataset.loading = 'false';
            this.pump();
          };

          img.onload = () => {
            this.loaded.add(url);
            done();
          };

          img.onerror = () => {
            this.failed.add(url);
            img.style.opacity = '.2';
            img.alt = 'Image unavailable';
            done();
          };

          img.src = url;
        }

        this.pump();
      }, this.delayMs);
    },

    observe(root = document) {
      if (!this.observer) {
        this.observer = new IntersectionObserver(entries => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              this.enqueue(entry.target);
              this.observer.unobserve(entry.target);
            }
          }
        }, {
          rootMargin: '300px 0px'
        });
      }

      root.querySelectorAll('img[data-src]').forEach(img => {
        if (this.loaded.has(img.dataset.src)) {
          img.src = img.dataset.src;
          return;
        }
        this.observer.observe(img);
      });
    },

    resetDetachedQueue() {
      this.queue = this.queue.filter(img => document.documentElement.contains(img));
      this.queued = new Set(this.queue);
    }
  };

  function cardHTML(c) {
    const safeName = escapeHtml(c.name);
    const safeImg = escapeHtml(c.image);
    return `
      <div class="card" data-char-id="${c.id}">
        <img class="thumb" data-src="${safeImg}" alt="" loading="lazy" referrerpolicy="no-referrer">
        <div class="char-data">
          <div class="char-name">${safeName}</div>
          <div class="ka">${c.value.toLocaleString()} ka</div>
        </div>
        <!--
        <div class="card-actions">
          <button class="small move-unsorted" title="Move back to unsorted">↩</button>
        </div>
        -->
      </div>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function makeBucket(name = 'Bucket') {
    state.buckets.push({ id: uid(), name, chars: [] });
    render();
    saveState();
  }

  function sortIds(ids, mode) {
    const copy = [...ids];
    const cmpName = (a, b) => getChar(a).name.localeCompare(getChar(b).name, undefined, { sensitivity: 'base' });

    if (mode === 'ka-desc') copy.sort((a, b) => getChar(b).value - getChar(a).value || cmpName(a, b));
    if (mode === 'ka-asc') copy.sort((a, b) => getChar(a).value - getChar(b).value || cmpName(a, b));
    if (mode === 'name-asc') copy.sort(cmpName);
    if (mode === 'name-desc') copy.sort((a, b) => -cmpName(a, b));
    if (mode === 'random') {
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
    }
    return copy;
  }

  function destroySortables() {
    sortableInstances.forEach(inst => inst.destroy());
    sortableInstances = [];
  }

  function getContainerIds(containerEl) {
    return Array.from(containerEl.querySelectorAll('.card'))
      .map(card => card.dataset.charId)
      .filter(Boolean);
  }

  function syncStateFromDOM() {
    state.unsorted = getContainerIds(unsortedEl);
    state.buckets.forEach(b => {
      const zone = bucketsEl.querySelector(`.bucket-zone[data-bucket-id="${b.id}"]`);
      if (zone) {
        b.chars = getContainerIds(zone);
      }
    });
  }

  function initSortable() {
    destroySortables();

    // Init Character list for Unsorted Container
    sortableInstances.push(
      new Sortable(unsortedEl, {
        group: 'characters',
        animation: 150,
        draggable: '.card',
        onEnd: () => {
          syncStateFromDOM();
          renderCounts();
          saveState();
        }
      })
    );

    // Init Character lists for all Bucket Containers
    document.querySelectorAll('.bucket-zone').forEach(zone => {
      sortableInstances.push(
        new Sortable(zone, {
          group: 'characters',
          animation: 150,
          draggable: '.card',
          onEnd: () => {
            syncStateFromDOM();
            renderCounts();
            saveState();
          }
        })
      );
    });

    // Init Bucket Container sorting (Reordering buckets relative to each other)
    sortableInstances.push(
      new Sortable(bucketsEl, {
        group: 'buckets',
        animation: 150,
        handle: '.bucket-handle',
        draggable: '.bucket',
        onEnd: () => {
          const newBuckets = [];
          bucketsEl.querySelectorAll('.bucket').forEach(bEl => {
            const id = bEl.dataset.bucketId;
            const b = state.buckets.find(x => x.id === id);
            if (b) newBuckets.push(b);
          });
          state.buckets = newBuckets;
          render();
          saveState();
        }
      })
    );
  }

  function renderCounts() {
    el('unsortedCount').textContent = `(${state.unsorted.length})`;
    const sorted = state.buckets.reduce((n, b) => n + b.chars.length, 0);
    el('sortedCount').textContent = `(${sorted})`;

    state.buckets.forEach(b => {
      const countEl = bucketsEl.querySelector(`.bucket[data-bucket-id="${b.id}"] .bucket-count`);
      if (countEl) {
        countEl.textContent = `${b.chars.length} character${b.chars.length === 1 ? '' : 's'}`;
      }
    });
  }

  function render() {
    unsortedEl.innerHTML = state.unsorted.length
      ? state.unsorted.map(id => cardHTML(getChar(id))).join('')
      : '';

    bucketsEl.innerHTML = state.buckets.map((b, i) => `
      <div class="bucket" data-bucket-id="${b.id}">
        <div class="bucket-header">
          <span class="bucket-handle" title="Drag bucket">☰</span>
          <input class="bucket-title" data-bucket-name="${b.id}" value="${escapeHtml(b.name)}">
          <span class="bucket-count">${b.chars.length} character${b.chars.length === 1 ? '' : 's'}</span>
          <span class="spacer"></span>
          <select class="bucket-sort" data-bucket-sort="${b.id}">
          <option value="">Sort…</option>
          <option value="ka-desc">Kakera ↓</option>
          <option value="ka-asc">Kakera ↑</option>
          <option value="name-asc">Name A → Z</option>
          <option value="name-desc">Name Z → A</option>
          <option value="random">Random</option>
          </select>
          <button class="small bucket-up" data-bucket-up="${b.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="small bucket-down" data-bucket-down="${b.id}" ${i === state.buckets.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="small danger delete-bucket" data-delete-bucket="${b.id}">Delete</button>
          <span class="bucket-collapse" title="Collapse">&lt;</span>
        </div>
        <div class="dropzone bucket-zone" data-container="bucket" data-bucket-id="${b.id}">${b.chars.map(id => cardHTML(getChar(id))).join('')}</div>
      </div>
    `).join('');

    renderCounts();
    initSortable();

    imageLoader.resetDetachedQueue();
    imageLoader.observe(document);
  }

  function moveBucket(id, delta) {
    const i = state.buckets.findIndex(b => b.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.buckets.length) return;
    [state.buckets[i], state.buckets[j]] = [state.buckets[j], state.buckets[i]];
    render();
    saveState();
  }

  function finalIds() {
    return state.buckets.flatMap(b => b.chars);
  }

  function commandFor(prefix, names) {
    return `${prefix} ${names.join(' $ ')}`.trim();
  }

  function generateCommands() {
    const names = finalIds().map(id => getChar(id).name);
    if (!names.length) {
      el('commandOutput').value = '';
      return;
    }

    const split = el('splitCommands').checked;
    const limit = Math.max(100, Number(el('charLimit').value) || 2000);
    const whole = commandFor('$sm', names);

    if (!split || whole.length <= limit) {
      el('commandOutput').value = whole;
      return;
    }

    const commands = [];
    let index = 0;
    let previousLast = null;

    while (index < names.length) {
      const prefix = previousLast === null ? '$sm' : `$smp ${previousLast} $`;
      const batch = [];

      while (index < names.length) {
        const testBatch = [...batch, names[index]];
        const test = previousLast === null
          ? commandFor('$sm', testBatch)
          : `${prefix} ${testBatch.join(' $ ')}`;

        if (test.length > limit && batch.length) break;

        batch.push(names[index]);
        index++;
        if (test.length > limit) break;
      }

      const cmd = previousLast === null
        ? commandFor('$sm', batch)
        : `${prefix} ${batch.join(' $ ')}`;
      commands.push(cmd);
      previousLast = batch[batch.length - 1];
    }

    el('commandOutput').value = commands.join('\n');
  }

  el('parseBtn').addEventListener('click', () => addParsed(sourceText.value));

  el('addBucket').addEventListener('click', () => makeBucket(`Bucket ${state.buckets.length + 1}`));

  el('unsortedSort').addEventListener('change', e => {
    if (!e.target.value) return;
    state.unsorted = sortIds(state.unsorted, e.target.value);
    e.target.value = '';
    render();
    saveState();
  });

  bucketsEl.addEventListener('change', e => {
    if (e.target.matches('[data-bucket-name]')) {
      const b = state.buckets.find(b => b.id === e.target.dataset.bucketName);
      if (b) b.name = e.target.value;
      saveState();
    }
    if (e.target.matches('[data-bucket-sort]')) {
      const b = state.buckets.find(b => b.id === e.target.dataset.bucketSort);
      if (b && e.target.value) b.chars = sortIds(b.chars, e.target.value);
      render();
      saveState();
    }
  });

  bucketsEl.addEventListener('click', e => {
    const del = e.target.closest('[data-delete-bucket]');
    if (del) {
      const id = del.dataset.deleteBucket;
      const i = state.buckets.findIndex(b => b.id === id);
      if (i >= 0) {
        // Move all items from deleted bucket back into state.unsorted
        state.unsorted.push(...state.buckets[i].chars);
        state.buckets.splice(i, 1);
        render();
        saveState();
      }
      return;
    }
    const up = e.target.closest('[data-bucket-up]');
    if (up) return moveBucket(up.dataset.bucketUp, -1);
    const down = e.target.closest('[data-bucket-down]');
    if (down) return moveBucket(down.dataset.bucketDown, 1);
  });

  document.addEventListener('click', e => {
    const back = e.target.closest('.move-unsorted');
    if (!back) return;
    const card = back.closest('.card');
    if (!card) return;
    const charId = card.dataset.charId;

    // Remove from whichever container currently holds it
    state.unsorted = state.unsorted.filter(x => x !== charId);
    state.buckets.forEach(b => b.chars = b.chars.filter(x => x !== charId));

    // Send to unsorted
    state.unsorted.push(charId);
    render();
    saveState();
  });

  el('saveBtn').addEventListener('click', () => saveState(true));
  el('generateBtn').addEventListener('click', generateCommands);

  el('copyBtn').addEventListener('click', async () => {
    const text = el('commandOutput').value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      el('copyBtn').textContent = 'Copied!';
      setTimeout(() => el('copyBtn').textContent = 'Copy', 1000);
    } catch {
      el('commandOutput').select();
      document.execCommand('copy');
    }
  });

  el('clearAll').addEventListener('click', () => {
    if (!confirm('Clear all imported characters, buckets, and this app\'s saved browser data?')) return;
    state.characters.clear();
    state.unsorted = [];
    state.buckets = [];
    parseStatus.textContent = '';
    el('commandOutput').value = '';
    makeBucket('Keep');
    localStorage.removeItem(storageKey);
    sessionStorage.removeItem(storageKey);
  });

  if (!loadState()) makeBucket('Keep');
  else render();
  setInterval(() => saveState(), autosaveIntervalMs);
})();