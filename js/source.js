(() => {

    /**==========================
     * CONSTANTS
     ==========================*/

    const state = {
        characters: new Map(),
        unsorted: [],
        buckets: [],
        otherCommands: []
    };

    const storageKey = 'mudae-harem-sorter-state';
    const autosaveIntervalMs = 5 * 60 * 1000;

    const el = id => document.getElementById(id);
    const sourceText = el('sourceText');
    const parseStatus = el('parseStatus');
    const unsortedEl = el('unsorted');
    const bucketsEl = el('buckets');
    const actionWrapper = el('actions-wrapper');
    const deleteButton = el('delete-characters');
    const divorceButton = el('divorce-characters');
    const noteButton = el('note-characters');
    const noteDialog = el('noteDialog');
    let pendingNoteIds = [];
    let commandNoticeTimeout;

    const mudaeCommandEl = el('mudae-command');
    const defaultCommand = '$mmsii-';
    const flags = {
        keys: {
            flag: 'y+',
            active: true
        },
        kakera: {
            flag: 'k',
            active: true
        },
        spheres: {
            flag: 'z+',
            active: true
        },
        embed_color: {
            flag: 'c+',
            active: true
        },
        default: {
            flag: 'm',
            active: true
        }
    }

    const defaultEmbedColor = '670d08';

    function getChar(id) {
        return state.characters.get(id);
    }

    /**===========================
     * State manager
     ============================*/

    function saveState(manual = false) {
        syncStateFromDOM();

        let used = state.unsorted.slice();
        state.buckets.forEach(bucket => {
            used = used.concat(bucket.chars);
        });

        const savedState = {
            characters: [...state.characters.values()].filter(c => used.includes(c.id)),
            unsorted: state.unsorted,
            buckets: state.buckets,
            otherCommands: state.otherCommands
        };

        updateGeneratedCommands();
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
                chars: (Array.isArray(bucket.chars) ? bucket.chars : []).filter(id => characterIds.has(id)),
                collapsed: bucket.collapsed === true
            }));
            const savedOtherCommands = Array.isArray(savedState.otherCommands)
                ? savedState.otherCommands
                : savedState.divorceCommands;
            state.otherCommands = Array.isArray(savedOtherCommands)
                ? savedOtherCommands
                    .filter(command => command && typeof command.id === 'string' && typeof command.text === 'string')
                    .map(command => ({ id: command.id, text: command.text }))
                : [];
            return true;
        } catch {
            localStorage.removeItem(storageKey);
            return false;
        }
    }


    /**===========================
     * Character functions
     ============================*/

    const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

    function normalizeUrl(url) {
        return url
            .replace(/\\~/g, '~')
            .replace(/[)"'\]\s]+$/g, '')
            .trim();
    }

    function parseCharacters(text) {
        const entryRe = /^\s*(.+?)(?:\s+\·\s+<?\:\w+key\:\d*\>?\s*\(\*{0,2}(\d[\d,\.\s]*)\*{0,2}\)\s*(?:\(\*{0,2}\#\*{0,2}([a-f\d]{6})\))?)?(?:\s+\*{0,2}(\d[\d,\.\s]+)\*{0,2}\s+ka)?(?:\s+\*{0,2}(\d[\d,\.\s]+)\*{0,2}\s+sp)?\s*-\s*<?(http.*?\.(?:png|gif|jpeg|jpg|webp))>?\s*$/gim;
        // const urlRe = /https:\/\/mudae\.net\/uploads\/[^\s)\]"']+/i;
        const found = [];
        let match;

        while ((match = entryRe.exec(text)) !== null) {
            const identifier = match[1].trim().replace(/^[)\]"]+/, '').trim();
            const parts = identifier.split('|');
            const name = parts.slice(0, -1).join('|').trim() || identifier.trim();
            const note = parts.length > 1 ? parts.at(-1).trim() : '';

            const keys = Number(match[2]?.replace(/[,\.\s]/g, '')) || 0;
            const embed_color = match[3] || defaultEmbedColor;
            const value = Number(match[4]?.replace(/[,\.\s]/g, '')) || 0;
            const sp = Number(match[5]?.replace(/[,\.\s]/g, '')) || 0;
            const urlMatch = match[6];

            if (!name || !Number.isFinite(value) || !urlMatch) continue;
            found.push({ id: uid(), name, note, keys, embed_color, value, sp, image: normalizeUrl(urlMatch) });
        }

        return found;
    }

    function getIdByName(name) {
        const n = name.trim().toLocaleLowerCase();
        for (const c of state.characters.values()) {
            if (c.name.trim().toLocaleLowerCase() === n) return c.id;
        }
        return undefined;
    }

    function addParsed(text) {
        const parsed = parseCharacters(text);
        let added = 0, duplicates = 0;

        for (const c of parsed) {
            if (existingId = getIdByName(c.name)) {
                c.id = existingId;
                duplicates++;
                state.characters.set(existingId, c);
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
            parseStatus.textContent = `Found ${parsed.length}; added ${added}${duplicates ? `; updated ${duplicates}` : ''}.`;
        }
    }

    function selectedCharacterIds(root) {
        return Array.from(root.querySelectorAll('.card-selected'))
            .map(card => card.dataset.charId)
            .filter(Boolean);
    }

    function updateBucketSelectionButton(zone) {
        const button = zone.closest('.bucket')?.querySelector('[data-select-bucket]');
        if (!button) return;

        const cards = Array.from(zone.querySelectorAll('.card'));
        const allSelected = cards.length > 0 && cards.every(card => card.classList.contains('card-selected'));
        button.textContent = allSelected ? 'Deselect all' : 'Select all';
    }

    function deleteCharacters(ids) {
        const idsToDelete = new Set(ids.filter(id => state.characters.has(id)));
        if (!idsToDelete.size) return;

        state.unsorted = state.unsorted.filter(id => !idsToDelete.has(id));
        state.buckets.forEach(bucket => {
            bucket.chars = bucket.chars.filter(id => !idsToDelete.has(id));
        });
        idsToDelete.forEach(id => state.characters.delete(id));

        render();
        saveState();
    }

    function divorceCharacters(ids) {
        const names = [...new Set(ids)]
            .map(id => getChar(id)?.name)
            .filter(Boolean);
        if (!names.length) return;

        const commands = splitSimpleCommands('$divorce', names, getMessageLimit());
        if (!commands) {
            alert('A character name is too long to fit in a Discord command with the current message limit.');
            render();
            return;
        }

        const generated = commands.map(text => ({ id: uid(), text }));
        state.otherCommands.unshift(...generated);
        deleteCharacters(ids);
        renderOtherCommands();
        showCommandNotice(generated[0].id, 'Divorce commands generated.');
    }

    function noteCharacters(ids, note) {
        const characters = [...new Set(ids)]
            .map(id => getChar(id))
            .filter(Boolean);
        if (!characters.length) return;

        const commands = splitNoteCommands(characters.map(character => character.name), note, getMessageLimit());
        if (!commands) {
            alert('The note and at least one character name do not fit within the current Discord message limit.');
            return;
        }

        characters.forEach(character => {
            character.note = note;
        });
        const generated = commands.map(text => ({ id: uid(), text }));
        state.otherCommands.unshift(...generated);
        render();
        renderOtherCommands();
        saveState();
        showCommandNotice(generated[0].id, 'Note command(s) generated.');
    }

    function openNoteDialog(ids) {
        pendingNoteIds = [...new Set(ids)].filter(id => state.characters.has(id));
        if (!pendingNoteIds.length) return;
        render();
        noteDialog.showModal();
        el('noteText').value = '';
        el('noteText').focus();
    }

    function submitNote() {
        const note = el('noteText').value.replace(/[\r\n]+/g, ' ').trim();
        const ids = pendingNoteIds;
        pendingNoteIds = [];
        noteDialog.close();
        noteCharacters(ids, note);
    }

    function getMessageLimit() {
        return Math.max(100, Number(el('charLimit').value) || 2000);
    }

    function splitSimpleCommands(prefix, names, limit) {
        const commands = [];
        let batch = [];

        for (const name of names) {
            const candidate = [...batch, name];
            if (commandFor(prefix, candidate).length <= limit) {
                batch = candidate;
                continue;
            }

            if (!batch.length) return null;

            commands.push(commandFor(prefix, batch));
            batch = [name];

            if (commandFor(prefix, batch).length > limit) return null;
        }

        if (batch.length) commands.push(commandFor(prefix, batch));
        return commands;
    }

    function splitNoteCommands(names, note, limit) {
        const commands = [];
        let batch = [];
        const format = batchNames => `$n ${batchNames.join(' $ ')} $${note ? ` ${note}` : ''}`;

        for (const name of names) {
            const candidate = [...batch, name];

            if (format(candidate).length <= limit) {
                batch = candidate;
                continue;
            }

            if (!batch.length) return null;

            commands.push(format(batch));
            batch = [name];

            if (format(batch).length > limit) return null;
        }

        if (batch.length) commands.push(format(batch));
        return commands;
    }

    /**===========================
      * Options
      ============================*/

    const button_switches = document.querySelectorAll('button[role="switch"]');

    for (const button_switch of button_switches) {
        button_switch.addEventListener('click', (e) => {
            const target = e.target;
            const state = target.getAttribute('aria-checked');
            const isState = (state === 'true');

            const selected_flag = target.id.slice(0, -7).replace('-', '_');
            flags[selected_flag]['active'] = !flags[selected_flag]['active'];

            let newCommand = defaultCommand;
            for (const flag_keys of Object.keys(flags)) {
                const flag = flags[flag_keys];
                if (!flag['active']) continue;

                newCommand += flag['flag'];
            }
            mudaeCommandEl.value = newCommand;

            target.setAttribute('aria-checked', isState ? false : true);
        });
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

    /**===========================
      * HTML INTERACTIVITY
      ============================*/

    function cardHTML(c) {
        const safeName = escapeHtml(c.name);
        const safeNote = escapeHtml(c.note || '');
        const safeImg = escapeHtml(c.image);
        return `
      <div class="card" data-char-id="${c.id}" style="border-left: 3px solid #${c?.embed_color || defaultEmbedColor};">
        <div class="char-data">
          <div class="char-name">${safeName}<span class="note">${safeNote}</span></div>
          <div class="keys">${c?.keys?.toLocaleString() || 0} 🗝️</div>
          <div class="ka">${c?.value?.toLocaleString() || 0} 𖢻</div>
          <div class="sp">${c?.sp?.toLocaleString() || 0} 🔴</div>
        </div>
        <img class="thumb" data-src="${safeImg}" alt="" loading="lazy" referrerpolicy="no-referrer" />
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

    function addActionInteractivity() {
        document.querySelectorAll('.action-button').forEach(actionBtn => {
            actionBtn.classList.add('action-started');
        })
    }

    function removeActionInteractivity() {
        document.querySelectorAll('.action-button').forEach(actionBtn => {
            actionBtn.classList.remove('action-started');
        })
    }

    function deleteActionCharacters() {
        document.querySelectorAll('.action-button').forEach(actionBtn => {
            actionBtn.innerHTML = '';
        });
    }

    // Wierd Firefox Behaviour
    const observer = new MutationObserver(() => {
        actionWrapper.querySelectorAll('.action-button').forEach(actionBtn => {
            actionBtn.classList.toggle('shaky', !actionBtn.matches(':empty'))
        })
    });

    observer.observe(actionWrapper, {
        childList: true,
        subtree: true
    })

    /**===========================
      * Sortables
      ============================*/

    let sortableInstances = [];
    let bucketSelectionObserver;

    function observeBucketSelections() {
        if (bucketSelectionObserver) bucketSelectionObserver.disconnect();

        bucketSelectionObserver = new MutationObserver(records => {
            const changedZones = new Set();
            records.forEach(record => {
                const zone = record.target.closest('.bucket-zone');
                if (zone) changedZones.add(zone);
            });
            changedZones.forEach(updateBucketSelectionButton);
        });

        document.querySelectorAll('.bucket-zone').forEach(zone => {
            bucketSelectionObserver.observe(zone, {
                attributes: true,
                attributeFilter: ['class'],
                childList: true,
                subtree: true
            });
        });
    }

    function sortIds(ids, mode) {
        const copy = [...ids];
        const cmpName = (a, b) => getChar(a).name.localeCompare(getChar(b).name, undefined, { sensitivity: 'base' });

        if (mode === 'ka-desc') copy.sort((a, b)    => (getChar(b)?.value || 0) - (getChar(a)?.value || 0));
        if (mode === 'ka-asc') copy.sort((a, b)     => (getChar(a)?.value || 0) - (getChar(b)?.value || 0));
        if (mode === 'keys-desc') copy.sort((a, b)  => (getChar(b)?.keys  || 0) - (getChar(a)?.keys  || 0));
        if (mode === 'keys-asc') copy.sort((a, b)   => (getChar(a)?.keys  || 0) - (getChar(b)?.keys  || 0));
        if (mode === 'sp-desc') copy.sort((a, b)    => (getChar(b)?.sp    || 0) - (getChar(a)?.sp    || 0));
        if (mode === 'sp-asc') copy.sort((a, b)     => (getChar(a)?.sp    || 0) - (getChar(b)?.sp    || 0));
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
                multiDrag: true, // Enable multi-drag
                selectedClass: 'card-selected', // The class applied to the selected items
                fallbackTolerance: 3, // So that we can select items on mobile
                onStart: function () {
                    addActionInteractivity();
                },
                onEnd: () => {
                    removeActionInteractivity();
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
                    multiDrag: true, // Enable multi-drag
                    selectedClass: 'card-selected', // The class applied to the selected items
                    fallbackTolerance: 3, // So that we can select items on mobile
                    onSelect: () => updateBucketSelectionButton(zone),
                    onDeselect: () => updateBucketSelectionButton(zone),
                    onStart: function () {
                        addActionInteractivity();
                    },
                    onEnd: () => {
                        removeActionInteractivity();
                        syncStateFromDOM();
                        renderCounts();
                        saveState();
                    }
                })
            );
        });

        function initActionZone(actionButton, onCharactersAdded) {
            sortableInstances.push(new Sortable(actionButton, {
                group: 'characters',
                animation: 150,
                draggable: '.card',
                multiDrag: true, // Enable multi-drag
                selectedClass: 'card-selected', // The class applied to the selected items
                fallbackTolerance: 3, // So that we can select items on mobile
                onAdd: () => {
                    const ids = getContainerIds(actionButton);
                    removeActionInteractivity();
                    onCharactersAdded(ids);
                },
            }));
        }

        initActionZone(deleteButton, deleteCharacters);
        initActionZone(divorceButton, divorceCharacters);
        initActionZone(noteButton, openNoteDialog);

        /**=============================
         * Init Bucket Container sorting (Reordering buckets relative to each other)
         =============================*/
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
            const kakeraEl = bucketsEl.querySelector(`.bucket[data-bucket-id="${b.id}"] .bucket-kakera`);
            if (kakeraEl) {
                const total = b.chars.reduce((sum, id) => sum + (Number(getChar(id)?.value) || 0), 0);
                kakeraEl.textContent = `${total.toLocaleString()} kakera`;
            }
        });
    }

    /**===========================
     * Rendering cards
     ============================*/

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
                <span class="bucket-kakera">${b.chars.reduce((sum, id) => sum + (Number(getChar(id)?.value) || 0), 0).toLocaleString()} kakera</span>
                <span class="spacer"></span>
                <select class="bucket-sort" data-bucket-sort="${b.id}">
                    <option value="">Sort…</option>
                    <option value="ka-desc">Kakera ↓</option>
                    <option value="ka-asc">Kakera ↑</option>
                    <option value="keys-desc">Keys ↓</option>
                    <option value="keys-asc">Keys ↑</option>
                    <option value="sp-desc">Spheres ↓</option>
                    <option value="sp-asc">Spheres ↑</option>
                    <option value="name-asc">Name A → Z</option>
                    <option value="name-desc">Name Z → A</option>
                    <option value="random">Random</option>
                </select>
                <button class="small bucket-select-all" data-select-bucket="${b.id}" type="button">Select all</button>
                <button class="small bucket-up" data-bucket-up="${b.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button class="small bucket-down" data-bucket-down="${b.id}" ${i === state.buckets.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="small danger delete-bucket" data-delete-bucket="${b.id}">Delete</button>
                <button class="small bucket-collapse" data-toggle-bucket="${b.id}" type="button" aria-expanded="${!b.collapsed}" aria-label="${b.collapsed ? 'Expand' : 'Collapse'} bucket">${b.collapsed ? 'Expand' : 'Collapse'}</button>
            </div>
            <div class="dropzone bucket-zone" data-container="bucket" data-bucket-id="${b.id}" ${b.collapsed ? 'hidden' : ''}>${b.chars.map(id => cardHTML(getChar(id))).join('')}</div>
        </div>
    `).join('');

        observeBucketSelections();
        deleteActionCharacters();

        renderCounts();
        initSortable();

        imageLoader.resetDetachedQueue();
        imageLoader.observe(document);
        updateGeneratedCommands();
    }

    function moveBucket(id, delta) {
        const i = state.buckets.findIndex(b => b.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= state.buckets.length) return;
        [state.buckets[i], state.buckets[j]] = [state.buckets[j], state.buckets[i]];
        render();
        saveState();
    }

    /**===========================
     * Command Generation
     ============================*/

    function finalIds() {
        return state.buckets.flatMap(b => b.chars);
    }

    function commandFor(prefix, names) {
        return `${prefix} ${names.join(' $ ')}`.trim();
    }

    function generateCommands() {
        const names = finalIds().map(id => getChar(id).name);
        if (!names.length) return [];

        const split = el('splitCommands').checked;
        const limit = Math.max(100, Number(el('charLimit').value) || 2000);
        const whole = commandFor('$sm', names);

        if (!split || whole.length <= limit) {
            return [whole];
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

        return commands;
    }

    function renderCommandTextareas(container, commands, { readOnly = false, dismissible = false } = {}) {
        container.innerHTML = commands.map(command => `
      <div class="command-item" id="${escapeHtml(command.itemId)}" data-command-id="${escapeHtml(command.id)}">
        <textarea ${readOnly ? 'readonly' : ''} aria-label="Command">${escapeHtml(command.text)}</textarea>
        <div class="command-actions">
          <button type="button" data-copy-command>Copy</button>
          ${dismissible ? '<button type="button" class="danger" data-dismiss-command>Dismiss</button>' : ''}
        </div>
      </div>
    `).join('');
    }

    function updateGeneratedCommands() {
        renderCommandTextareas(el('commandOutput'), generateCommands().map((text, index) => ({
            id: `generated-${index}`,
            itemId: `generated-command-${index}`,
            text
        })), { readOnly: true });
    }

    function renderOtherCommands() {
        renderCommandTextareas(el('otherCommandOutput'), state.otherCommands.map(command => ({
            ...command,
            itemId: `other-command-${command.id}`
        })), { readOnly: true, dismissible: true });
    }

    function showCommandNotice(commandId, message) {
        const notice = el('commandNotice');
        notice.hidden = false;
        notice.dataset.commandId = commandId;
        el('commandNoticeText').textContent = message;
        clearTimeout(commandNoticeTimeout);
        commandNoticeTimeout = setTimeout(() => {
            notice.hidden = true;
        }, 10000);
    }

    async function copyCommand(button) {
        const textarea = button.closest('.command-item').querySelector('textarea');
        try {
            await navigator.clipboard.writeText(textarea.value);
        } catch {
            textarea.select();
            if (!document.execCommand('copy')) {
                alert('Unable to copy this command in this browser.');
                return;
            }
        }
        button.textContent = 'Copied!';
        setTimeout(() => button.textContent = 'Copy', 1000);
    }

    /**===========================
     * Event listeners
     ============================*/

    el('parseBtn').addEventListener('click', () => addParsed(sourceText.value));

    el('addBucket').addEventListener('click', () => makeBucket(`Bucket ${state.buckets.length + 1}`));

    el('splitCommands').addEventListener('change', updateGeneratedCommands);
    el('charLimit').addEventListener('input', updateGeneratedCommands);

    el('unsortedSort').addEventListener('change', e => {
        if (!e.target.value) return;
        state.unsorted = sortIds(state.unsorted, e.target.value);
        e.target.value = '';
        render();
        saveState();
    });

    deleteButton.addEventListener('click', () => {
        const ids = selectedCharacterIds(document);
        if (!ids.length || !confirm('Are you sure you want to delete all selected characters?')) return;
        deleteCharacters(ids);
    });

    divorceButton.addEventListener('click', () => {
        const ids = selectedCharacterIds(document);
        if (!ids.length || !confirm('Are you sure you want to divorce all selected characters?')) return;
        divorceCharacters(selectedCharacterIds(document));
    });

    noteButton.addEventListener('click', () => {
        openNoteDialog(selectedCharacterIds(document));
    });

    noteDialog.addEventListener('close', () => {
        if (pendingNoteIds.length) render();
        pendingNoteIds = [];
    });
    el('noteForm').addEventListener('submit', event => {
        event.preventDefault();
        submitNote();
    });
    el('cancelNote').addEventListener('click', () => noteDialog.close());
    el('noteText').addEventListener('input', event => {
        const textarea = event.target;
        const cursor = textarea.selectionStart;
        const value = textarea.value.replace(/[\r\n]+/g, ' ');
        if (value !== textarea.value) {
            textarea.value = value;
            textarea.setSelectionRange(Math.min(cursor, value.length), Math.min(cursor, value.length));
        }
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
        const selectAll = e.target.closest('[data-select-bucket]');
        if (selectAll) {
            const bucketEl = selectAll.closest('.bucket');
            const zone = bucketEl?.querySelector('.bucket-zone');
            if (!zone) return;

            const cards = Array.from(zone.querySelectorAll('.card'));
            const allSelected = cards.length > 0 && cards.every(card => card.classList.contains('card-selected'));
            cards.forEach(card => {
                if (allSelected) Sortable.utils.deselect(card);
                else Sortable.utils.select(card);
            });
            updateBucketSelectionButton(zone);
            return;
        }
        const toggle = e.target.closest('[data-toggle-bucket]');
        if (toggle) {
            const bucket = state.buckets.find(b => b.id === toggle.dataset.toggleBucket);
            if (!bucket) return;
            bucket.collapsed = !bucket.collapsed;
            render();
            saveState();
            return;
        }
        const del = e.target.closest('[data-delete-bucket]');
        if (del) {
            const id = del.dataset.deleteBucket;
            const i = state.buckets.findIndex(b => b.id === id);
            if (i >= 0 && confirm(`Delete "${state.buckets[i].name}"? Its characters will be moved back to Unsorted.`)) {
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
    document.addEventListener('click', event => {
        const copyButton = event.target.closest('[data-copy-command]');
        if (copyButton) {
            copyCommand(copyButton);
            return;
        }

        const dismissButton = event.target.closest('[data-dismiss-command]');
        if (dismissButton) {
            const commandId = dismissButton.closest('.command-item').dataset.commandId;
            state.otherCommands = state.otherCommands.filter(command => command.id !== commandId);
            renderOtherCommands();
            saveState();
            return;
        }

        if (event.target.closest('#clearOtherCommands')) {
            if (!state.otherCommands.length || !confirm('Clear all generated commands?')) return;
            state.otherCommands = [];
            renderOtherCommands();
            saveState();
            return;
        }

        if (event.target.closest('#takeMeToCommand')) {
            const commandId = el('commandNotice').dataset.commandId;
            const command = document.getElementById(`other-command-${commandId}`);
            if (!command) return;
            command.scrollIntoView({ behavior: 'smooth', block: 'center' });
            command.classList.add('command-highlight');
            setTimeout(() => command.classList.remove('command-highlight'), 2000);
            el('commandNotice').hidden = true;
            clearTimeout(commandNoticeTimeout);
        }

        if (event.target.closest('#dismissCommandNotice')) {
            el('commandNotice').hidden = true;
            clearTimeout(commandNoticeTimeout);
        }
    });

    el('copyCmd').addEventListener('click', async event => {
        if (!mudaeCommandEl.value) return;
        try {
            await navigator.clipboard.writeText(mudaeCommandEl.value);
        } catch {
            mudaeCommandEl.select();
            if (!document.execCommand('copy')) {
                alert('Unable to copy this command in this browser.');
                return;
            }
        }
        event.target.textContent = 'Copied!';
        setTimeout(() => event.target.textContent = 'Copy', 1000);
    });

    el('clearAll').addEventListener('click', () => {
        if (!confirm('Clear all imported characters, buckets, and this app\'s saved browser data?')) return;
        state.characters.clear();
        state.unsorted = [];
        state.buckets = [];
        state.otherCommands = [];
        parseStatus.textContent = '';
        render();
        renderOtherCommands();
        makeBucket('Keep');
        localStorage.removeItem(storageKey);
        sessionStorage.removeItem(storageKey);
    });

    if (!loadState()) makeBucket('Keep');
    else {
        render();
        renderOtherCommands();
    }
    setInterval(() => saveState(), autosaveIntervalMs);
})();