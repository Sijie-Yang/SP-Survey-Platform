/**
 * Session Learning for Contextual Engineering
 * 
 * Stores long-term learning across multiple sessions
 * Uses localStorage for persistence across browser sessions
 */

export class SessionLearning {
  constructor(userId = 'default') {
    this.userId = userId;
    this.storage = {
      sessions: [],
      globalPreferences: {},
      commonPatterns: [],
      projectTypes: {},
      expertise: {
        beginner: true,
        level: 0,
        completedSurveys: 0
      }
    };
    this.currentSessionId = this.generateSessionId();
    this.loadFromStorage();
    this.initializeSession();
  }

  /**
   * Initialize a new session
   */
  initializeSession() {
    const existingSession = this.storage.sessions.find(
      s => s.id === this.currentSessionId
    );
    
    if (!existingSession) {
      this.storage.sessions.push({
        id: this.currentSessionId,
        startTime: new Date().toISOString(),
        endTime: null,
        projects: [],
        interactions: 0,
        success: false
      });
      this.saveToStorage();
    }
  }

  /**
   * Record a project interaction
   */
  recordProjectInteraction(projectId, projectType, interaction) {
    const session = this.getCurrentSession();
    
    if (!session.projects.includes(projectId)) {
      session.projects.push(projectId);
    }
    
    session.interactions += 1;
    session.lastInteraction = new Date().toISOString();
    
    // Track project type
    if (!this.storage.projectTypes[projectType]) {
      this.storage.projectTypes[projectType] = {
        count: 0,
        successRate: 0,
        averageIterations: 0,
        preferences: {}
      };
    }
    
    this.storage.projectTypes[projectType].count += 1;
    
    // Update expertise
    this.updateExpertise(interaction);
    
    this.saveToStorage();
  }

  /**
   * Record successful survey completion
   */
  recordSuccess(projectId, iterations, surveyType) {
    const session = this.getCurrentSession();
    session.success = true;
    session.endTime = new Date().toISOString();
    
    // Update project type statistics
    if (this.storage.projectTypes[surveyType]) {
      const stats = this.storage.projectTypes[surveyType];
      const prevTotal = stats.count - 1;
      stats.successRate = (stats.successRate * prevTotal + 1) / stats.count;
      stats.averageIterations = 
        (stats.averageIterations * prevTotal + iterations) / stats.count;
    }
    
    // Update expertise
    this.storage.expertise.completedSurveys += 1;
    this.storage.expertise.level = Math.floor(
      this.storage.expertise.completedSurveys / 3
    );
    
    if (this.storage.expertise.completedSurveys >= 3) {
      this.storage.expertise.beginner = false;
    }
    
    this.saveToStorage();
  }

  /**
   * Learn a global preference
   */
  learnGlobalPreference(key, value, weight = 1.0) {
    if (!this.storage.globalPreferences[key]) {
      this.storage.globalPreferences[key] = {
        value,
        weight,
        observations: 1
      };
    } else {
      const pref = this.storage.globalPreferences[key];
      
      // If value is the same, increase weight
      if (JSON.stringify(pref.value) === JSON.stringify(value)) {
        pref.weight = Math.min(1.0, pref.weight + 0.1);
        pref.observations += 1;
      } else {
        // If value is different, reduce weight and potentially replace
        pref.weight = Math.max(0.1, pref.weight - 0.2);
        if (pref.weight < 0.5) {
          pref.value = value;
          pref.weight = 0.5;
        }
        pref.observations += 1;
      }
    }
    
    this.saveToStorage();
  }

  /**
   * Learn a common pattern
   */
  learnPattern(pattern, context = '') {
    const existing = this.storage.commonPatterns.find(
      p => p.pattern === pattern
    );
    
    if (existing) {
      existing.frequency += 1;
      existing.lastSeen = new Date().toISOString();
      existing.confidence = Math.min(1.0, existing.confidence + 0.05);
    } else {
      this.storage.commonPatterns.push({
        id: this.generateId(),
        pattern,
        context,
        frequency: 1,
        confidence: 0.3,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      });
    }
    
    this.saveToStorage();
  }

  /**
   * Get recommendations based on learned patterns
   */
  getRecommendations(projectType = null) {
    const recommendations = [];
    
    // Based on expertise level
    if (this.storage.expertise.beginner) {
      recommendations.push({
        type: 'guidance',
        priority: 'high',
        message: 'Pro tip: Start with a template and modify it, or use AI generation with clear descriptions.',
        source: 'expertise_level'
      });
    }
    
    // Based on project type history
    if (projectType && this.storage.projectTypes[projectType]) {
      const stats = this.storage.projectTypes[projectType];
      
      if (stats.count > 0) {
        recommendations.push({
          type: 'insight',
          priority: 'medium',
          message: `You've created ${stats.count} ${projectType} survey(s) before. Average iterations: ${stats.averageIterations.toFixed(1)}`,
          source: 'project_history'
        });
      }
      
      // Recommend preferences
      if (stats.preferences && Object.keys(stats.preferences).length > 0) {
        const topPref = Object.entries(stats.preferences)
          .sort(([_, a], [__, b]) => b - a)[0];
        
        if (topPref) {
          recommendations.push({
            type: 'suggestion',
            priority: 'medium',
            message: `For ${projectType} surveys, you typically prefer: ${topPref[0]}`,
            source: 'learned_preferences'
          });
        }
      }
    }
    
    // Based on common patterns
    const topPatterns = this.storage.commonPatterns
      .filter(p => p.confidence > 0.6)
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 3);
    
    topPatterns.forEach(pattern => {
      recommendations.push({
        type: 'pattern',
        priority: 'low',
        message: pattern.pattern,
        source: 'common_patterns'
      });
    });
    
    return recommendations;
  }

  /**
   * Get context for AI (to be included in system prompt)
   */
  getContextForAI(projectType = null) {
    let context = '=== LONG-TERM LEARNING CONTEXT ===\n\n';
    
    // User expertise
    const expertise = this.storage.expertise;
    if (expertise.beginner) {
      context += 'User Profile: Beginner (provide extra guidance and explanations)\n\n';
    } else {
      context += `User Profile: Experienced (Level ${expertise.level}, completed ${expertise.completedSurveys} surveys)\n\n`;
    }
    
    // Project type history
    if (projectType && this.storage.projectTypes[projectType]) {
      const stats = this.storage.projectTypes[projectType];
      context += `Project Type History (${projectType}):\n`;
      context += `  - Created ${stats.count} time(s)\n`;
      context += `  - Success rate: ${(stats.successRate * 100).toFixed(0)}%\n`;
      context += `  - Average iterations: ${stats.averageIterations.toFixed(1)}\n\n`;
    }
    
    // Global preferences
    const strongPreferences = Object.entries(this.storage.globalPreferences)
      .filter(([_, pref]) => pref.weight > 0.7 && pref.observations >= 3)
      .map(([key, pref]) => `  - ${key}: ${JSON.stringify(pref.value)} (strong preference, seen ${pref.observations} times)`)
      .join('\n');
    
    if (strongPreferences) {
      context += `Global User Preferences:\n${strongPreferences}\n\n`;
    }
    
    // Common patterns
    const frequentPatterns = this.storage.commonPatterns
      .filter(p => p.frequency >= 3 && p.confidence > 0.6)
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 3)
      .map(p => `  - ${p.pattern} (observed ${p.frequency} times)`)
      .join('\n');
    
    if (frequentPatterns) {
      context += `User's Common Patterns:\n${frequentPatterns}\n\n`;
    }
    
    return context;
  }

  /**
   * Get session statistics
   */
  getStats() {
    const totalSessions = this.storage.sessions.length;
    const successfulSessions = this.storage.sessions.filter(s => s.success).length;
    const totalInteractions = this.storage.sessions.reduce(
      (sum, s) => sum + s.interactions, 0
    );
    
    return {
      totalSessions,
      successfulSessions,
      successRate: totalSessions > 0 ? successfulSessions / totalSessions : 0,
      totalInteractions,
      completedSurveys: this.storage.expertise.completedSurveys,
      expertiseLevel: this.storage.expertise.level,
      isBeginner: this.storage.expertise.beginner
    };
  }

  /**
   * Clear all learning data
   */
  clearAll() {
    this.storage = {
      sessions: [],
      globalPreferences: {},
      commonPatterns: [],
      projectTypes: {},
      expertise: {
        beginner: true,
        level: 0,
        completedSurveys: 0
      }
    };
    this.saveToStorage();
  }

  /**
   * Export learning data
   */
  export() {
    return {
      userId: this.userId,
      exportTime: new Date().toISOString(),
      storage: this.storage,
      stats: this.getStats()
    };
  }

  // Private methods
  
  getCurrentSession() {
    return this.storage.sessions.find(s => s.id === this.currentSessionId);
  }

  updateExpertise(interaction) {
    // Simple expertise tracking based on interaction count
    if (interaction.includes('generate') || interaction.includes('adjust')) {
      const totalInteractions = this.storage.sessions.reduce(
        (sum, s) => sum + s.interactions, 0
      );
      
      // Every 10 interactions, increase expertise
      const newLevel = Math.floor(totalInteractions / 10);
      if (newLevel > this.storage.expertise.level) {
        this.storage.expertise.level = newLevel;
      }
    }
  }

  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateId() {
    return `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  saveToStorage() {
    const key = `session_learning_${this.userId}`;
    try {
      localStorage.setItem(key, JSON.stringify(this.storage));
    } catch (error) {
      console.warn('Failed to save session learning data:', error);
    }
  }

  loadFromStorage() {
    const key = `session_learning_${this.userId}`;
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.storage = { ...this.storage, ...parsed };
      }
    } catch (error) {
      console.warn('Failed to load session learning data:', error);
    }
  }
}

/**
 * Get session learning instance (singleton per user)
 */
let instance = null;

export function getSessionLearning(userId = 'default') {
  if (!instance || instance.userId !== userId) {
    instance = new SessionLearning(userId);
  }
  return instance;
}

