Ok, let's balance the game a bit

- install ebisu (https://github.com/fasiha/ebisu.js/blob/gh-pages/README.md)
- setup a clean IndexedDB to track learning events and learning items

Let's adapt the algo that places objects on the board to be a bit more targeted.
A given board has exactly one correct action (dragging a specific object onto a specific object).
Btw, in case we're not doing that already, let's ensure that we never place the same object multiple times on the same board.
Then, a board has a number of distractors, defined by the other objects on board, and the actions they allow.
We encode the difficulty as follows

- `0.3` for each action that could theoretically be done, but doesn't have any relationship encoded with it, so it is never a correct action
- `1` for each action that has a relationship associated with it (but the condition below does not apply)
- `2` for each action that has a relationship associated with it that overlaps with the correct action in either sending or receiving object

Each incorrect action should clearly map to one of the three conditions above and be counted accordingly.

Then, thanks to our learning item tracking (per object and language, as in "does the player on average handle 'Table' in `deu` correctly"), we can also see whether the two objects involved in the task have been seen before (we can theoretically see more than that, but this is enough for now). Based on this, we define the following difficulty targets:

- If one or both objects involved in the task are new to the player, the difficulty limit is `<2`
- Otherwise, the difficulty should be LOWER THAN the difficulty of the previous task if the player got the last task wrong, and higher than the difficulty of the previous task if the player got that one right.

Add some helper to draw 

1. a random object with no relationships (receiving or sending)
2. a random object with relationships not overlapping with the correct action's objects
3. a random object that does have relationship overlap with the the correct action

So you can semi-smartly pick objects, trying to hit the target.
For now, simply start as we're currently with randomly picking and placing an object that has relationships, then randomly picking and placing an object from the set of receivers of those relationships, and from then on use the smart picking functions to fill the board until you just go over the desired difficulty limit, then stop