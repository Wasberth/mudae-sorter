(() => {
    const actionButtons = document.querySelectorAll('.action-button');

    actionButtons.forEach(actionButton => {
        ['pointerup', 'mouseup', 'touchend'].forEach(eventName => {
            actionButton.addEventListener(eventName, evt => {
                evt.stopPropagation();
            });
        });
    });
})();