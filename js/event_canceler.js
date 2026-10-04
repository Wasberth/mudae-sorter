(() => {
    const el = id => document.getElementById(id);
    const deleteDiv = el('delete-characters');

    ['pointerup', 'mouseup', 'touchend'].forEach(eventName => {
        deleteDiv.addEventListener(eventName, evt => {
            evt.stopPropagation();
        });
    });
})();