/**
 * Working Memory for Contextual Engineering
 * 
 * Stores design decisions, user preferences, and contextual information
 * that the AI can reference when generating/adjusting surveys
 */

export class WorkingMemory {
  constructor(projectId) {
    this.projectId = projectId;
    this.memory = {
      designDecisions: [],
      userPreferences: {},
      surveyGoal: null,
      targetAudience: null,
      previousIterations: [],
      learnedPatterns: []
    };
    this.loadFromStorage();
  }

  /**
   * Record a design decision
   */
  addDesignDecision(decision, reasoning = '') {
    this.memory.designDecisions.push({
      id: this.generateId(),
      decision,
      reasoning,
      timestamp: new Date().toISOString()
    });
    this.saveToStorage();
  }

  /**
   * Update user preference
   */
  setUserPreference(key, value, confidence = 1.0) {
    if (!this.memory.userPreferences[key]) {
      this.memory.userPreferences[key] = {
        value,
        confidence,
        firstSeen: new Date().toISOString(),
        count: 1
      };
    } else {
      // Update confidence based on repeated observations
      this.memory.userPreferences[key].value = value;
      this.memory.userPreferences[key].confidence = Math.min(
        1.0,
        this.memory.userPreferences[key].confidence + 0.1
      );
      this.memory.userPreferences[key].count += 1;
      this.memory.userPreferences[key].lastSeen = new Date().toISOString();
    }
    this.saveToStorage();
  }

  /**
   * Get user preference
   */
  getUserPreference(key) {
    return this.memory.userPreferences[key] || null;
  }

  /**
   * Set survey goal
   */
  setSurveyGoal(goal) {
    this.memory.surveyGoal = goal;
    this.saveToStorage();
  }

  /**
   * Set target audience
   */
  setTargetAudience(audience) {
    this.memory.targetAudience = audience;
    this.saveToStorage();
  }

  /**
   * Record a survey iteration
   */
  addIteration(config, userFeedback = '') {
    const iteration = {
      id: this.generateId(),
      version: this.memory.previousIterations.length + 1,
      config: this.extractConfigSummary(config),
      userFeedback,
      timestamp: new Date().toISOString()
    };
    
    this.memory.previousIterations.push(iteration);
    
    // Analyze patterns from this iteration
    this.analyzePatterns(config, userFeedback);
    
    this.saveToStorage();
    return iteration;
  }

  /**
   * Learn a pattern from user behavior
   */
  learnPattern(pattern, context = '') {
    const existing = this.memory.learnedPatterns.find(p => p.pattern === pattern);
    
    if (existing) {
      existing.count += 1;
      existing.confidence = Math.min(1.0, existing.confidence + 0.1);
      existing.lastSeen = new Date().toISOString();
    } else {
      this.memory.learnedPatterns.push({
        id: this.generateId(),
        pattern,
        context,
        confidence: 0.5,
        count: 1,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      });
    }
    
    this.saveToStorage();
  }

  /**
   * Get contextual summary for AI prompt
   */
  getContextForAI() {
    const preferences = Object.entries(this.memory.userPreferences)
      .filter(([_, pref]) => pref.confidence > 0.6)
      .map(([key, pref]) => `${key}: ${JSON.stringify(pref.value)} (confidence: ${pref.confidence.toFixed(2)})`)
      .join('\n  - ');
    
    const patterns = this.memory.learnedPatterns
      .filter(p => p.confidence > 0.6)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(p => `${p.pattern} (seen ${p.count} times)`)
      .join('\n  - ');
    
    const recentIterations = this.memory.previousIterations
      .slice(-3)
      .map(iter => `Version ${iter.version}: ${iter.userFeedback || 'no feedback'}`)
      .join('\n  - ');
    
    let context = '=== WORKING MEMORY CONTEXT ===\n\n';
    
    if (this.memory.surveyGoal) {
      context += `Survey Goal: ${this.memory.surveyGoal}\n\n`;
    }
    
    if (this.memory.targetAudience) {
      context += `Target Audience: ${this.memory.targetAudience}\n\n`;
    }
    
    if (preferences) {
      context += `User Preferences (learned from behavior):\n  - ${preferences}\n\n`;
    }
    
    if (patterns) {
      context += `Learned Patterns:\n  - ${patterns}\n\n`;
    }
    
    if (recentIterations) {
      context += `Recent Iterations:\n  - ${recentIterations}\n\n`;
    }
    
    const stats = this.getStats();
    if (stats.totalIterations > 0) {
      context += `Design Statistics:\n`;
      context += `  - Total iterations: ${stats.totalIterations}\n`;
      context += `  - Average questions per page: ${stats.avgQuestionsPerPage.toFixed(1)}\n`;
      context += `  - Most used question types: ${stats.mostUsedQuestionTypes.join(', ')}\n\n`;
    }
    
    return context;
  }

  /**
   * Get memory statistics
   */
  getStats() {
    const iterations = this.memory.previousIterations;
    
    if (iterations.length === 0) {
      return {
        totalIterations: 0,
        avgQuestionsPerPage: 0,
        mostUsedQuestionTypes: []
      };
    }
    
    const questionCounts = iterations.map(i => i.config.totalQuestions || 0);
    const pageCounts = iterations.map(i => i.config.totalPages || 0);
    
    const avgQuestionsPerPage = questionCounts.reduce((a, b) => a + b, 0) / 
                                 pageCounts.reduce((a, b) => a + b, 1);
    
    // Count question types across all iterations
    const typeCount = {};
    iterations.forEach(iter => {
      (iter.config.questionTypes || []).forEach(type => {
        typeCount[type] = (typeCount[type] || 0) + 1;
      });
    });
    
    const mostUsedQuestionTypes = Object.entries(typeCount)
      .sort(([_, a], [__, b]) => b - a)
      .slice(0, 3)
      .map(([type, _]) => type);
    
    return {
      totalIterations: iterations.length,
      avgQuestionsPerPage,
      mostUsedQuestionTypes,
      totalDesignDecisions: this.memory.designDecisions.length,
      learnedPatterns: this.memory.learnedPatterns.length
    };
  }

  /**
   * Clear memory
   */
  clear() {
    this.memory = {
      designDecisions: [],
      userPreferences: {},
      surveyGoal: null,
      targetAudience: null,
      previousIterations: [],
      learnedPatterns: []
    };
    this.saveToStorage();
  }

  /**
   * Export memory
   */
  export() {
    return {
      projectId: this.projectId,
      exportTime: new Date().toISOString(),
      memory: this.memory,
      stats: this.getStats()
    };
  }

  // Private methods
  
  extractConfigSummary(config) {
    if (!config || !config.pages) {
      return { totalPages: 0, totalQuestions: 0, questionTypes: [] };
    }
    
    const totalPages = config.pages.length;
    let totalQuestions = 0;
    const questionTypes = new Set();
    
    config.pages.forEach(page => {
      if (page.elements) {
        totalQuestions += page.elements.length;
        page.elements.forEach(el => {
          if (el.type) questionTypes.add(el.type);
        });
      }
    });
    
    return {
      totalPages,
      totalQuestions,
      questionTypes: Array.from(questionTypes)
    };
  }

  analyzePatterns(config, feedback) {
    // Analyze rating scales
    if (config && config.pages) {
      config.pages.forEach(page => {
        page.elements?.forEach(element => {
          if (element.type === 'imagerating' || element.type === 'rating') {
            const scale = `${element.rateMin || 1}-${element.rateMax || 5}`;
            this.setUserPreference('preferredRatingScale', scale, 0.7);
          }
          
          if (element.imageCount) {
            this.setUserPreference('preferredImageCount', element.imageCount, 0.6);
          }
        });
      });
    }
    
    // Analyze feedback
    if (feedback) {
      const lowerFeedback = feedback.toLowerCase();
      
      if (lowerFeedback.includes('too long') || lowerFeedback.includes('too many')) {
        this.learnPattern('User prefers shorter surveys', feedback);
      }
      
      if (lowerFeedback.includes('more image')) {
        this.learnPattern('User prefers more image-based questions', feedback);
      }
      
      if (lowerFeedback.includes('simpler') || lowerFeedback.includes('easier')) {
        this.learnPattern('User prefers simpler question types', feedback);
      }
    }
  }

  generateId() {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  saveToStorage() {
    const key = `working_memory_${this.projectId}`;
    try {
      sessionStorage.setItem(key, JSON.stringify(this.memory));
    } catch (error) {
      console.warn('Failed to save working memory:', error);
    }
  }

  loadFromStorage() {
    const key = `working_memory_${this.projectId}`;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored) {
        this.memory = JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Failed to load working memory:', error);
    }
  }
}

/**
 * Create or retrieve working memory for a project
 */
export function getWorkingMemory(projectId) {
  return new WorkingMemory(projectId);
}

