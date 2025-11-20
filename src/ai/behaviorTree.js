/**
 * Behavior Tree System
 * Hierarchical AI decision-making structure
 */

/**
 * Node execution status
 */
export const NodeStatus = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  RUNNING: 'running'
};

/**
 * Node types for debugging
 */
export const NodeType = {
  COMPOSITE: 'composite',
  DECORATOR: 'decorator',
  LEAF: 'leaf'
};

/**
 * Base Behavior Node Class
 */
export class BehaviorNode {
  constructor(name = 'Node') {
    this.name = name;
    this.type = NodeType.LEAF;
  }

  /**
   * Execute the node logic
   * @param {Object} context - Shared context object with game state
   * @returns {string} NodeStatus - SUCCESS, FAILURE, or RUNNING
   */
  tick(context) {
    throw new Error(`tick() must be implemented in ${this.constructor.name}`);
  }

  /**
   * Reset node state (for repeating sequences)
   */
  reset() {
    // Override in subclasses if needed
  }
}

/**
 * Selector Node (OR logic)
 * Succeeds if ANY child succeeds
 * Returns on first success or running
 */
export class Selector extends BehaviorNode {
  constructor(name, children = []) {
    super(name);
    this.type = NodeType.COMPOSITE;
    this.children = children;
  }

  tick(context) {
    for (const child of this.children) {
      const status = child.tick(context);

      // Return immediately on success or running
      if (status === NodeStatus.SUCCESS || status === NodeStatus.RUNNING) {
        return status;
      }
    }

    // All children failed
    return NodeStatus.FAILURE;
  }

  reset() {
    this.children.forEach(child => child.reset());
  }

  addChild(child) {
    this.children.push(child);
  }
}

/**
 * Sequence Node (AND logic)
 * Succeeds only if ALL children succeed in order
 * Returns on first failure or running
 */
export class Sequence extends BehaviorNode {
  constructor(name, children = []) {
    super(name);
    this.type = NodeType.COMPOSITE;
    this.children = children;
    this.currentIndex = 0;
  }

  tick(context) {
    for (let i = this.currentIndex; i < this.children.length; i++) {
      const status = this.children[i].tick(context);

      // Continue to next child on success
      if (status === NodeStatus.SUCCESS) {
        continue;
      }

      // Wait on running
      if (status === NodeStatus.RUNNING) {
        this.currentIndex = i;
        return NodeStatus.RUNNING;
      }

      // Fail immediately
      if (status === NodeStatus.FAILURE) {
        this.reset();
        return NodeStatus.FAILURE;
      }
    }

    // All children succeeded
    this.reset();
    return NodeStatus.SUCCESS;
  }

  reset() {
    this.currentIndex = 0;
    this.children.forEach(child => child.reset());
  }

  addChild(child) {
    this.children.push(child);
  }
}

/**
 * Parallel Node
 * Runs all children simultaneously
 * Succeeds if successThreshold children succeed
 * Fails if failureThreshold children fail
 */
export class Parallel extends BehaviorNode {
  constructor(name, children = [], successThreshold = 1, failureThreshold = 1) {
    super(name);
    this.type = NodeType.COMPOSITE;
    this.children = children;
    this.successThreshold = successThreshold;
    this.failureThreshold = failureThreshold;
  }

  tick(context) {
    let successCount = 0;
    let failureCount = 0;

    for (const child of this.children) {
      const status = child.tick(context);

      if (status === NodeStatus.SUCCESS) {
        successCount++;
      } else if (status === NodeStatus.FAILURE) {
        failureCount++;
      }
    }

    if (successCount >= this.successThreshold) {
      return NodeStatus.SUCCESS;
    }

    if (failureCount >= this.failureThreshold) {
      return NodeStatus.FAILURE;
    }

    return NodeStatus.RUNNING;
  }

  reset() {
    this.children.forEach(child => child.reset());
  }
}

/**
 * Condition Node
 * Evaluates a condition function
 */
export class Condition extends BehaviorNode {
  constructor(name, checkFn) {
    super(name);
    this.checkFn = checkFn;
  }

  tick(context) {
    const result = this.checkFn(context);
    return result ? NodeStatus.SUCCESS : NodeStatus.FAILURE;
  }
}

/**
 * Action Node
 * Executes an action function
 */
export class Action extends BehaviorNode {
  constructor(name, actionFn) {
    super(name);
    this.actionFn = actionFn;
  }

  tick(context) {
    return this.actionFn(context);
  }
}

/**
 * Inverter Decorator
 * Inverts the result of its child
 */
export class Inverter extends BehaviorNode {
  constructor(name, child) {
    super(name);
    this.type = NodeType.DECORATOR;
    this.child = child;
  }

  tick(context) {
    const status = this.child.tick(context);

    if (status === NodeStatus.SUCCESS) {
      return NodeStatus.FAILURE;
    } else if (status === NodeStatus.FAILURE) {
      return NodeStatus.SUCCESS;
    }

    return NodeStatus.RUNNING;
  }

  reset() {
    this.child.reset();
  }
}

/**
 * Repeater Decorator
 * Repeats its child a specified number of times
 */
export class Repeater extends BehaviorNode {
  constructor(name, child, count = -1) {
    super(name);
    this.type = NodeType.DECORATOR;
    this.child = child;
    this.maxCount = count; // -1 for infinite
    this.currentCount = 0;
  }

  tick(context) {
    if (this.maxCount !== -1 && this.currentCount >= this.maxCount) {
      return NodeStatus.SUCCESS;
    }

    const status = this.child.tick(context);

    if (status === NodeStatus.SUCCESS || status === NodeStatus.FAILURE) {
      this.currentCount++;
      this.child.reset();

      if (this.maxCount !== -1 && this.currentCount >= this.maxCount) {
        return NodeStatus.SUCCESS;
      }
    }

    return NodeStatus.RUNNING;
  }

  reset() {
    this.currentCount = 0;
    this.child.reset();
  }
}

/**
 * Cooldown Decorator
 * Prevents child from running until cooldown expires
 */
export class Cooldown extends BehaviorNode {
  constructor(name, child, cooldownMs) {
    super(name);
    this.type = NodeType.DECORATOR;
    this.child = child;
    this.cooldownMs = cooldownMs;
    this.lastRunTime = 0;
  }

  tick(context) {
    const now = Date.now();
    const elapsed = now - this.lastRunTime;

    if (elapsed < this.cooldownMs) {
      return NodeStatus.FAILURE;
    }

    const status = this.child.tick(context);

    if (status === NodeStatus.SUCCESS) {
      this.lastRunTime = now;
    }

    return status;
  }

  reset() {
    this.child.reset();
  }
}

/**
 * UntilFail Decorator
 * Runs child repeatedly until it fails
 */
export class UntilFail extends BehaviorNode {
  constructor(name, child) {
    super(name);
    this.type = NodeType.DECORATOR;
    this.child = child;
  }

  tick(context) {
    const status = this.child.tick(context);

    if (status === NodeStatus.FAILURE) {
      return NodeStatus.SUCCESS;
    }

    this.child.reset();
    return NodeStatus.RUNNING;
  }

  reset() {
    this.child.reset();
  }
}

/**
 * Behavior Tree Main Class
 * Manages the root node and ticking
 */
export class BehaviorTree {
  constructor(name, rootNode) {
    this.name = name;
    this.rootNode = rootNode;
  }

  /**
   * Tick the behavior tree
   * @param {Object} context - Shared context object
   * @returns {string} NodeStatus
   */
  tick(context) {
    if (!this.rootNode) {
      console.warn(`⚠️ BehaviorTree ${this.name} has no root node`);
      return NodeStatus.FAILURE;
    }

    return this.rootNode.tick(context);
  }

  /**
   * Reset the entire tree
   */
  reset() {
    if (this.rootNode) {
      this.rootNode.reset();
    }
  }
}
