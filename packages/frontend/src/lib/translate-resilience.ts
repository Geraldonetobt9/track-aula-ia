// Google Translate (and similar in-page translators) rewrites text nodes
// directly in the DOM. React keeps references to the original nodes for its
// reconciliation, so when it later tries to remove/insert them the parent no
// longer matches and the operation throws — crashing the entire subtree.
// See https://github.com/facebook/react/issues/11538

const originalRemoveChild = Node.prototype.removeChild;
Node.prototype.removeChild = function <T extends Node>(child: T): T {
  if (child.parentNode !== this) {
    if (child.parentNode) {
      return originalRemoveChild.call(child.parentNode, child) as T;
    }
    return child;
  }
  return originalRemoveChild.call(this, child) as T;
} as typeof Node.prototype.removeChild;

const originalInsertBefore = Node.prototype.insertBefore;
Node.prototype.insertBefore = function <T extends Node>(
  newNode: T,
  referenceNode: Node | null,
): T {
  if (referenceNode && referenceNode.parentNode !== this) {
    return originalInsertBefore.call(this, newNode, null) as T;
  }
  return originalInsertBefore.call(this, newNode, referenceNode) as T;
} as typeof Node.prototype.insertBefore;
