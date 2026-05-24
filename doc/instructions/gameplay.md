So far, we built some basic frame for this language learning game: Loading a board, and displaying a random task.
Let's build the actual gameplay.
Essentially, players can drag any object onto any object, and this drag motion can be correct or incorrect.

For better understandability, replace the rotation effect on hover and the wiggle effect when hovering while dragging with a slight scale-up effect.

On dragend, decide whether the task was fulfilled (correct object dragged onto correct object).

- If not, simply do nothing (dragged object snaps back, just as it does now, completely fine).
- If yes, do the correct action according to the effects encoded in the task's relationships ("NOTHING", "RETURN", "DISAPPEAR", "DESTRUCT", "WIGGLE", "HELD"), color the task's font green and after 0.6 seconds generate a new random board with a new random task
    - NOTHING: only valid for the receiving object B (drop target). Simply don't do anything
    - RETURN: valid for the dragged object A. Means to move back to OG position.
    - DISAPPEAR: quick short shrink animation, then disappear
    - DESTRUCT: short, violent shake and scale up/down animation, then disappear
    - WIGGLE: wiggle in the way the current drop target does when hovered
    - HELD: means that object A should be scaled and placed on B's board with the offset and scale factor defined in B's JSON (see @public/objects/couch.json as a data structure example). If "HELD" is defined but hold data is missing, simply disappear object A instead

Do not implement more than asked here.
Implement cleanly, pattern-driven.