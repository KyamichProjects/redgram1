
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatWindow } from './components/ChatWindow';
import { ProfilePanel } from './components/ProfilePanel';
import { SettingsModal } from './components/SettingsModal';
import { CreateGroupModal } from './components/CreateGroupModal';
import { AddContactModal } from './components/AddContactModal';
import { PremiumModal } from './components/PremiumModal';
import { RegistrationScreen } from './components/RegistrationScreen';
import { AdminPanel } from './components/AdminPanel';
import { ChatSocket, ChatPreview, Message, Call, UserProfile } from './services/ChatSocket';
import { AIService } from './services/AIService';
import { translations, Language } from './utils/translations';
import { ThemeKey, THEMES } from './utils/themes';

// --- Constants & Keys ---

const STORAGE_KEYS = {
    ACCOUNTS: 'redgram_accounts_v1',
    // These keys are dynamic based on User ID: redgram_chats_{userId}
    CHATS_PREFIX: 'redgram_chats_',
    // Messages remain global for now as a shared database, but in a real app would be DB based
    MESSAGES: 'redgram_messages_v1', 
    SETTINGS: 'redgram_settings_v1',
    ARCHIVE: 'redgram_archive_v1',
    CALLS: 'redgram_calls_v1',
    REGISTRATION: 'redgram_reg_complete_v1',
};

// Enhanced Initial Data with distinct personas
const INITIAL_CHATS: ChatPreview[] = [
  { 
      id: '1', 
      name: 'Saved Messages', 
      color: 'bg-sky-500 text-white', 
      lastMessage: 'Cloud storage', 
      timestamp: Date.now(), 
      unreadCount: 0, 
      isOnline: true,
      bio: 'Your personal cloud storage.',
      username: 'saved_messages', // Reserved
      sender: 'me'
  },
  { 
      id: '2', 
      name: 'Gemini AI', 
      color: 'bg-gradient-to-br from-blue-500 to-purple-500 text-white', 
      lastMessage: 'I am ready to help.', 
      timestamp: Date.now(), 
      unreadCount: 1, 
      isOnline: true, 
      isBot: true,
      username: 'gemini_bot',
      bio: 'I am a large language model, trained by Google. Ask me anything!',
      sender: 'them'
  }
];

const INITIAL_MESSAGES: Record<string, Message[]> = {
    '1': [],
    '2': [
        { id: 'm3', chatId: '2', text: 'Hello! I am Gemini. How can I assist you today?', sender: 'them', senderId: '2', timestamp: Date.now(), status: 'read' }
    ]
};

const DEFAULT_PROFILE: UserProfile = {
    id: 'user',
    name: 'New User',
    phone: '',
    bio: 'Hi there! I am using RedGram.',
    username: 'user',
    avatarColor: 'bg-gradient-to-br from-red-500 to-orange-500',
    isPremium: false,
    privacy: { 
        profilePhoto: 'everybody',
        phoneNumber: 'nobody',
        lastSeen: 'everybody',
        stories: 'everybody'
    }
};

const App: React.FC = () => {
  // --- State Initialization ---

  const [accounts, setAccounts] = useState<UserProfile[]>(() => {
      try {
          const saved = localStorage.getItem(STORAGE_KEYS.ACCOUNTS);
          return saved ? JSON.parse(saved) : [];
      } catch { return []; }
  });

  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
      // Default to first account or empty default
      if (accounts.length > 0) return accounts[0];
      return DEFAULT_PROFILE;
  });

  // Track if we should show the registration screen (either no accounts, or user explicitly requested 'add account')
  const [showRegistration, setShowRegistration] = useState(() => {
     try {
         const hasReg = localStorage.getItem(STORAGE_KEYS.REGISTRATION);
         // If no registration flag OR no accounts in list, show reg
         const savedAccounts = localStorage.getItem(STORAGE_KEYS.ACCOUNTS);
         const parsedAccounts = savedAccounts ? JSON.parse(savedAccounts) : [];
         return !hasReg || parsedAccounts.length === 0;
     } catch { return true; }
  });

  // --- Dynamic State per Account ---

  // Helper to load chats for a specific user ID
  const loadChatsForUser = (userId: string): ChatPreview[] => {
      try {
          const saved = localStorage.getItem(STORAGE_KEYS.CHATS_PREFIX + userId);
          if (saved) {
              return JSON.parse(saved);
          }
          return INITIAL_CHATS;
      } catch { return INITIAL_CHATS; }
  };

  const [chats, setChats] = useState<ChatPreview[]>(() => loadChatsForUser(userProfile.id));

  const [messages, setMessages] = useState<Record<string, Message[]>>(() => {
      try {
          const saved = localStorage.getItem(STORAGE_KEYS.MESSAGES);
          return saved ? JSON.parse(saved) : INITIAL_MESSAGES;
      } catch { return INITIAL_MESSAGES; }
  });
  
  const [calls, setCalls] = useState<Call[]>(() => {
      try {
          const saved = localStorage.getItem(STORAGE_KEYS.CALLS);
          return saved ? JSON.parse(saved) : [];
      } catch { return []; }
  });

  const [settings, setSettings] = useState<{lang: Language, theme: ThemeKey}>(() => {
      try {
          const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
          const parsed = saved ? JSON.parse(saved) : {};
          return { lang: parsed.lang || 'en', theme: parsed.theme || 'glass' };
      } catch { return { lang: 'en', theme: 'glass' }; }
  });

  const [archivedChatIds, setArchivedChatIds] = useState<Set<string>>(() => {
      try {
          const saved = localStorage.getItem(STORAGE_KEYS.ARCHIVE);
          return saved ? new Set(JSON.parse(saved)) : new Set();
      } catch { return new Set(); }
  });

  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);
  
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);

  const [typingMap, setTypingMap] = useState<Record<string, boolean>>({});
  const [showArchiveView, setShowArchiveView] = useState(false);
  const [showCallsView, setShowCallsView] = useState(false);

  // Admin Panel State
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminMessages, setAdminMessages] = useState<Message[]>([]);
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(false);

  // Safe Language Access
  const lang = (settings.lang === 'en' || settings.lang === 'ru') ? settings.lang : 'en';
  // Safe Theme Access
  const themeKey = (settings.theme && THEMES[settings.theme]) ? settings.theme : 'glass';
  const currentTheme = THEMES[themeKey];
  const t = translations[lang] || translations['en'];

  const socketRef = useRef<ChatSocket | null>(null);
  const aiServiceRef = useRef<AIService>(new AIService());
  
  // Keep track of all known users from server to create chats with correct info
  const userDirectoryRef = useRef<Record<string, UserProfile>>({});

  // --- Start Up Logic & Account Switching ---
  
  // 1. Initialize Socket and Presence whenever User Profile ID changes (Account Switch)
  useEffect(() => {
    // Clean up old socket if exists
    if (socketRef.current) {
        socketRef.current.disconnect();
    }

    // Initialize Socket Connection using current window location to support LAN
    // Fix: Fallback to localhost if hostname is empty
    const socket = new ChatSocket(); 
    socketRef.current = socket;

    // Only identify if we are actually registered/logged in
    if (!showRegistration && userProfile.username) {
        socket.registerUser({
             ...userProfile,
             id: userProfile.username
        });
    }

    // Subscribe to updates
    const unsubscribe = socket.subscribe((data) => {
        if (data.type === 'NEW_MESSAGE') {
            const msg = data.message as Message;
            // Handle message logic
            if (msg.senderId !== userProfile.username) {
                handleIncomingMessage(msg);
            }
        } else if (data.type === 'USER_JOINED') {
            handleNewUserJoined(data.profile);
        } else if (data.type === 'USER_SYNC') {
            handleUserSync(data.users);
        } else if (data.type === 'MESSAGE_READ') {
            handleReadReceipt(data.chatId, data.messageIds, data.readerId);
        } else if (data.type === 'USER_UPDATED') {
            // Handle profile updates (e.g. premium status)
            if (data.profile.id === userProfile.id) {
                setUserProfile(prev => ({ ...prev, ...data.profile }));
                setAccounts(prev => prev.map(acc => acc.id === data.profile.id ? { ...acc, ...data.profile } : acc));
            }
        } else if (data.type === 'ADMIN_DATA') {
            setAdminMessages(data.messages);
            setIsLoadingAdmin(false);
        }
    });

    return () => {
        unsubscribe();
        socket.disconnect();
    };
  }, [userProfile.id, showRegistration]);

  const handleOpenAdmin = () => {
      setShowAdminPanel(true);
      setIsLoadingAdmin(true);
      if (socketRef.current) {
          socketRef.current.getAdminData(userProfile.id);
      }
  };

  const handleRefreshAdmin = () => {
      setIsLoadingAdmin(true);
      if (socketRef.current) {
          socketRef.current.getAdminData(userProfile.id);
      }
  }; 

  // --- Persistence Effects ---

  useEffect(() => {
      // Save accounts list
      localStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(accounts));
  }, [accounts]);

  useEffect(() => {
      // Save current chats to SCALED key
      if (userProfile.id && !showRegistration) {
          localStorage.setItem(STORAGE_KEYS.CHATS_PREFIX + userProfile.id, JSON.stringify(chats));
      }
  }, [chats, userProfile.id]);

  useEffect(() => {
      // Messages are global store
      localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messages));
  }, [messages]);

  // Update current account in the accounts list if userProfile changes (e.g. edit profile)
  useEffect(() => {
      if (!showRegistration) {
          setAccounts(prev => prev.map(acc => acc.id === userProfile.id ? userProfile : acc));
      }
  }, [userProfile]);

  // --- Read Receipts Logic ---
  useEffect(() => {
      if (activeChatId && socketRef.current) {
          const chatMessages = messages[activeChatId] || [];
          const unreadMessages = chatMessages.filter(m => {
              const isMine = m.senderId === userProfile.username || m.sender === 'me';
              return !isMine && m.status !== 'read';
          });

          if (unreadMessages.length > 0) {
              const idsToMark = unreadMessages.map(m => m.id);
              
              setMessages(prev => ({
                  ...prev,
                  [activeChatId]: prev[activeChatId].map(m => 
                      idsToMark.includes(m.id) ? { ...m, status: 'read' } : m
                  )
              }));

              socketRef.current.sendReadReceipt(activeChatId, idsToMark);

              setChats(prev => prev.map(c => 
                  c.id === activeChatId ? { ...c, unreadCount: 0 } : c
              ));
          }
      }
  }, [activeChatId, messages]);

  // --- Handlers ---

  const handleReadReceipt = (chatId: string, messageIds: string[], readerId: string) => {
      let targetLocalChatId = chatId;
      const potentialGroup = chats.find(c => c.id === chatId && c.isGroup);
      
      if (!potentialGroup) {
          targetLocalChatId = readerId;
      }

      setMessages(prev => {
          const currentList = prev[targetLocalChatId];
          if (!currentList) return prev;

          const needsUpdate = currentList.some(m => messageIds.includes(m.id) && m.status !== 'read');
          if (!needsUpdate) return prev;

          return {
              ...prev,
              [targetLocalChatId]: currentList.map(m => 
                  messageIds.includes(m.id) ? { ...m, status: 'read' } : m
              )
          };
      });
  };

  const handleSwitchAccount = (newProfile: UserProfile) => {
      setActiveChatId(null);
      setViewingProfileId(null);
      localStorage.setItem(STORAGE_KEYS.CHATS_PREFIX + userProfile.id, JSON.stringify(chats));
      const newChats = loadChatsForUser(newProfile.id);
      setUserProfile(newProfile);
      setChats(newChats);
  };

  const handleAddAccountRequest = () => {
      setShowRegistration(true);
  };

  const handleBuyPremium = () => {
      setUserProfile(prev => ({ ...prev, isPremium: true }));
      setShowPremiumModal(false);
  };

  const handleUserSync = (users: UserProfile[]) => {
      // Update directory
      users.forEach(u => {
          userDirectoryRef.current[u.username] = u;
      });

      // Automatically add new discovered users to chat list if they aren't there
      setChats(prev => {
          const newChats = [...prev];
          let changed = false;

          users.forEach(u => {
              if (u.username === userProfile.username) return; // Don't add self

              // Check if chat exists by ID (username) or if it is a member of any group? 
              // Simplification: Check if we have a DM with them
              const exists = newChats.find(c => c.username === u.username);
              
              if (!exists) {
                  // Add them to the list so we can chat immediately
                  const newContact: ChatPreview = {
                      id: u.username, 
                      name: u.name,
                      username: u.username,
                      bio: u.bio,
                      phone: u.phone,
                      color: u.avatarColor,
                      lastMessage: '',
                      timestamp: Date.now(),
                      unreadCount: 0,
                      isOnline: true,
                      isBot: false
                  };
                  newChats.push(newContact);
                  changed = true;
              }
          });
          return changed ? newChats : prev;
      });
  }

  const handleNewUserJoined = (profile: UserProfile) => {
      userDirectoryRef.current[profile.username] = profile;

      if (profile.username === userProfile.username) return;
      
      setChats(prev => {
          if (prev.find(c => c.username === profile.username)) return prev;

          const newContact: ChatPreview = {
              id: profile.username, 
              name: profile.name,
              username: profile.username,
              bio: profile.bio,
              phone: profile.phone,
              color: profile.avatarColor,
              lastMessage: '',
              timestamp: Date.now(),
              unreadCount: 0,
              isOnline: true,
              isBot: false
          };
          
          const systemMsg: Message = {
              id: Date.now().toString(),
              chatId: profile.username,
              text: t.contactJoined,
              sender: 'them',
              senderId: 'system',
              timestamp: Date.now(),
              status: 'read'
          };
          
          setMessages(mPrev => ({
              ...mPrev,
              [profile.username]: [systemMsg]
          }));

          return [newContact, ...prev];
      });
  };
  
  const handleIncomingMessage = (msg: Message) => {
    let targetChatId = msg.chatId;
    
    // Check if we have a chat with this ID
    let existingChat = chats.find(c => c.id === msg.chatId);
    
    // Logic for DM: msg.chatId is usually the RECEIVER ID (me). 
    // We need to route this message to the chat associated with the SENDER.
    if (msg.chatId === userProfile.username) {
        // Direct Message to ME
        targetChatId = msg.senderId || 'unknown';
        existingChat = chats.find(c => c.id === targetChatId);
    } 
    // If it's a group, targetChatId remains the Group ID.

    setMessages(prev => ({
        ...prev,
        [targetChatId]: [...(prev[targetChatId] || []), msg]
    }));

    setChats(prev => {
        const chatIndex = prev.findIndex(c => c.id === targetChatId);
        
        // If chat doesn't exist (new sender), CREATE IT AUTOMATICALLY
        if (chatIndex === -1) {
            const senderInfo = userDirectoryRef.current[targetChatId];
            const newChat: ChatPreview = {
                id: targetChatId,
                name: senderInfo ? senderInfo.name : (targetChatId || 'Unknown'), 
                username: targetChatId,
                color: senderInfo ? senderInfo.avatarColor : 'bg-gray-500',
                lastMessage: msg.text,
                timestamp: msg.timestamp,
                unreadCount: 1,
                isOnline: true,
                isBot: false,
                sender: 'them'
            };
            return [newChat, ...prev];
        }
        
        const chat = prev[chatIndex];
        const isActive = activeChatId === targetChatId;

        const updatedChat = { 
            ...chat, 
            lastMessage: msg.text,
            timestamp: msg.timestamp,
            unreadCount: isActive ? chat.unreadCount : chat.unreadCount + 1,
            sender: msg.sender
        };
        
        const newChats = [...prev];
        newChats.splice(chatIndex, 1);
        return [updatedChat, ...newChats];
    });
  };

  const handleSendMessage = async (text: string, attachment?: { type: 'voice' | 'image' | 'file', mediaUrl: string, fileName?: string, fileSize?: string, duration?: number }) => {
    if (!activeChatId || !socketRef.current) return;
    
    const chat = chats.find(c => c.id === activeChatId);
    if (!chat) return;

    // 1. Send via Socket
    socketRef.current.sendMessage(activeChatId, text, chat.id, chat.isGroup, attachment);

    // 2. Optimistic Local Update
    const userMsg: Message = { 
        id: Date.now().toString(), 
        chatId: activeChatId, 
        text, 
        sender: 'me', 
        senderId: userProfile.username, 
        timestamp: Date.now(), 
        status: 'sent',
        ...attachment
    };
    
    setMessages(prev => ({
        ...prev,
        [activeChatId]: [...(prev[activeChatId] || []), userMsg]
    }));

    setChats(prev => {
        const chatIndex = prev.findIndex(c => c.id === activeChatId);
        if (chatIndex === -1) return prev;
        
        const updatedChat: ChatPreview = { 
            ...prev[chatIndex], 
            lastMessage: text,
            timestamp: Date.now(),
            sender: 'me'
        };
        
        const newChats = [...prev];
        newChats.splice(chatIndex, 1);
        return [updatedChat, ...newChats];
    });

    // 3. Sync to other local accounts
    if (chat.isGroup && chat.memberIds) {
        chat.memberIds.forEach(memberId => {
            if (memberId === userProfile.username) return; 

            const targetAcc = accounts.find(a => a.id === memberId || a.username === memberId);
            if (targetAcc) {
                const targetChats = loadChatsForUser(targetAcc.id);
                const groupIndex = targetChats.findIndex(c => c.id === chat.id);
                
                if (groupIndex > -1) {
                    const groupChat = targetChats[groupIndex];
                    const updatedGroup: ChatPreview = {
                        ...groupChat,
                        lastMessage: text,
                        timestamp: Date.now(),
                        unreadCount: groupChat.unreadCount + 1,
                        sender: 'them' 
                    };
                    targetChats.splice(groupIndex, 1);
                    targetChats.unshift(updatedGroup);
                    localStorage.setItem(STORAGE_KEYS.CHATS_PREFIX + targetAcc.id, JSON.stringify(targetChats));
                }
            }
        });
    }

    const targetAccount = accounts.find(acc => acc.id === activeChatId);
    if (targetAccount) {
        const targetChats = loadChatsForUser(targetAccount.id);
        let senderChatIndex = targetChats.findIndex(c => c.id === userProfile.username);
        
        if (senderChatIndex === -1) {
            const newChatEntry: ChatPreview = {
                id: userProfile.username,
                name: userProfile.name,
                username: userProfile.username,
                color: userProfile.avatarColor,
                lastMessage: text,
                timestamp: Date.now(),
                unreadCount: 1, 
                isOnline: true,
                isBot: false,
                sender: 'them' 
            };
            targetChats.unshift(newChatEntry);
        } else {
            const existing = targetChats[senderChatIndex];
            targetChats.splice(senderChatIndex, 1);
            const updatedExisting: ChatPreview = {
                ...existing,
                lastMessage: text,
                timestamp: Date.now(),
                unreadCount: existing.unreadCount + 1,
                sender: 'them'
            };
            targetChats.unshift(updatedExisting);
        }
        
        localStorage.setItem(STORAGE_KEYS.CHATS_PREFIX + targetAccount.id, JSON.stringify(targetChats));
        
        const msgForTarget: Message = {
            ...userMsg,
            sender: 'them', 
            chatId: userProfile.username 
        };
        
        setMessages(prev => ({
            ...prev,
            [userProfile.username]: [...(prev[userProfile.username] || []), msgForTarget]
        }));
    }

    // 4. AI Logic - RESTRICTED to BOTS ONLY
    if (chat.isBot && !chat.isGroup && chat.id !== '1') {
        const currentMsgs = messages[activeChatId] || [];
        const historyForAI = [...currentMsgs, userMsg];
        await generateBotResponse(activeChatId, historyForAI, chat);
    }
  };

  const generateBotResponse = async (chatId: string, history: Message[], bot: ChatPreview, contextPrompt?: string): Promise<string> => {
        setTypingMap(prev => ({ ...prev, [chatId]: true }));
        try {
            const lastMsgText = history[history.length - 1].text;
            const finalBio = contextPrompt 
                ? `${contextPrompt}. Your name is ${bot.name}. ${bot.bio || 'Helpful bot'}` 
                : `${bot.bio || "A helpful assistant"}`;
            
            const responseText = await aiServiceRef.current.generateResponse(
                history, 
                lastMsgText, 
                bot.name, 
                finalBio
            );
            
            const finalResponse = responseText;
            await simulateTypingAndSend(chatId, finalResponse, bot.id);
            return finalResponse;
        } finally {
            setTypingMap(prev => ({ ...prev, [chatId]: false }));
        }
  };

  const simulateTypingAndSend = async (chatId: string, text: string, senderId?: string) => {
        const delay = Math.min(Math.max(text.length * 30, 1500), 6000); 
        await new Promise(resolve => setTimeout(resolve, delay));

        const botMsg: Message = {
            id: Date.now().toString(),
            chatId: chatId,
            text: text,
            sender: 'them',
            senderId: senderId, 
            timestamp: Date.now(),
            status: 'read'
        };
        handleIncomingMessage(botMsg);
  };

  const handleAddChat = (newChat: ChatPreview) => {
      setChats(prev => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      setShowCallsView(false);
      setShowArchiveView(false);
  };

  const handleAddNewContact = (firstName: string, lastName: string, phone: string) => {
      const fullName = `${firstName} ${lastName}`.trim();
      const id = Date.now().toString(); 
      const newContact: ChatPreview = {
          id: id,
          name: fullName,
          username: firstName.toLowerCase() + '_' + id.slice(-4),
          phone: phone,
          isOnline: false,
          unreadCount: 0,
          timestamp: Date.now(),
          lastMessage: '',
          color: 'bg-gradient-to-tr from-emerald-400 to-teal-500 text-white',
          bio: 'Contact added manually.',
          isBot: true 
      };
      handleAddChat(newContact);
      
      const systemMsg: Message = {
          id: Date.now().toString(),
          chatId: id,
          text: t.contactCreated,
          sender: 'them',
          senderId: 'system',
          timestamp: Date.now(),
          status: 'read'
      };
      setMessages(prev => ({ ...prev, [id]: [systemMsg] }));
  };

  const handleSelectChat = (id: string) => {
      setActiveChatId(id);
      setChats(prev => prev.map(c => c.id === id ? { ...c, unreadCount: 0 } : c));
  };

  const handleToggleArchive = (chatId: string) => {
      setArchivedChatIds(prev => {
          const next = new Set(prev);
          if (next.has(chatId)) {
              next.delete(chatId);
          } else {
              next.add(chatId);
              if (activeChatId === chatId) setActiveChatId(null);
          }
          return next;
      });
  };

  const handleToggleMute = (chatId: string) => {
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, muted: !c.muted } : c));
  };

  const handleUpdateGroup = (chatId: string, updates: Partial<ChatPreview>) => {
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, ...updates } : c));
      if (updates.name || updates.bio) {
           const systemMsg: Message = {
                id: Date.now().toString(),
                chatId,
                text: t.groupInfoUpdated,
                sender: 'them',
                timestamp: Date.now(),
                status: 'read'
            };
            handleIncomingMessage(systemMsg);
      }
  };
  
  const handleAddMember = (chatId: string, contactId: string) => {
      const contact = chats.find(c => c.id === contactId);
      if (!contact) return;
      
      const systemMsg: Message = {
          id: Date.now().toString(),
          chatId,
          text: `${contact.name} ${t.wasAdded}`,
          sender: 'them',
          timestamp: Date.now(),
          status: 'read'
      };

      setMessages(prev => ({
          ...prev,
          [chatId]: [...(prev[chatId] || []), systemMsg]
      }));

      setChats(prev => {
          const index = prev.findIndex(c => c.id === chatId);
          if (index === -1) return prev;
          
          const chat = prev[index];
          const currentMembers = chat.memberIds || [];
          const newMembers = currentMembers.includes(contactId) ? currentMembers : [...currentMembers, contactId];

          const updatedChat = {
              ...chat,
              membersCount: (chat.membersCount || 0) + 1,
              lastMessage: systemMsg.text,
              timestamp: systemMsg.timestamp,
              memberIds: newMembers
          };
          
          const newChats = [...prev];
          newChats.splice(index, 1); 
          return [updatedChat, ...newChats];
      });
  };

  const handleDeleteChat = (chatId: string) => {
      setChats(prev => prev.filter(c => c.id !== chatId));
      if (activeChatId === chatId) setActiveChatId(null);
      if (viewingProfileId === chatId) setViewingProfileId(null);
  };

  const handleCreateGroup = (name: string, username: string, selectedContactIds: string[]) => {
      const newChat: ChatPreview = {
          id: Date.now().toString(),
          name: name.trim(),
          username: username.trim(),
          isGroup: true,
          color: 'bg-gradient-to-br from-orange-400 to-pink-500 text-white',
          isOnline: true,
          unreadCount: 0,
          timestamp: Date.now(),
          lastMessage: t.group + ' created',
          bio: 'A new awesome group.',
          isAdmin: true, 
          membersCount: selectedContactIds.length + 1,
          memberIds: selectedContactIds
      };
      
      // 1. Add to Current User
      setChats(prev => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      setShowCallsView(false);

      const msgs: Message[] = [{
          id: Date.now().toString(),
          chatId: newChat.id,
          text: 'Group created.',
          sender: 'them',
          timestamp: Date.now(),
          status: 'read'
      }];
      
      setMessages(prev => ({
          ...prev,
          [newChat.id]: msgs
      }));

      // 2. Add Group to Other Local Accounts (Sync)
      selectedContactIds.forEach(contactId => {
          const targetAcc = accounts.find(a => a.id === contactId);
          if (targetAcc) {
              const targetChats = loadChatsForUser(targetAcc.id);
              // Prevent duplicates
              if (!targetChats.find(c => c.id === newChat.id)) {
                  const groupForTarget: ChatPreview = { ...newChat, isAdmin: false, unreadCount: 1 };
                  const updated = [groupForTarget, ...targetChats];
                  localStorage.setItem(STORAGE_KEYS.CHATS_PREFIX + targetAcc.id, JSON.stringify(updated));
              }
          }
      });
  };

  const handleRegistrationComplete = (name: string, username: string) => {
      const newProfile: UserProfile = {
          id: username, 
          name,
          username,
          phone: '', // Phone is no longer collected
          bio: 'Hi! I am new here.',
          avatarColor: 'bg-gradient-to-br from-red-500 to-orange-500',
          isPremium: false,
          privacy: { 
             profilePhoto: 'everybody',
             phoneNumber: 'nobody',
             lastSeen: 'everybody',
             stories: 'everybody'
          }
      };

      // 1. Notify Existing Accounts about New User (Local Sync)
      accounts.forEach(existingAcc => {
          const existingChats = loadChatsForUser(existingAcc.id);
          if (!existingChats.find(c => c.id === username)) {
              const newContactChat: ChatPreview = {
                  id: username,
                  name: name,
                  username: username,
                  bio: newProfile.bio,
                  phone: '',
                  color: newProfile.avatarColor,
                  lastMessage: t.contactJoined,
                  timestamp: Date.now(),
                  unreadCount: 1,
                  isOnline: true,
                  isBot: false,
                  sender: 'them'
              };
              const updatedChats = [newContactChat, ...existingChats];
              localStorage.setItem(STORAGE_KEYS.CHATS_PREFIX + existingAcc.id, JSON.stringify(updatedChats));
              
              const joinMsg: Message = {
                  id: Date.now().toString() + Math.random(),
                  chatId: username,
                  text: t.contactJoined,
                  sender: 'them',
                  senderId: 'system',
                  timestamp: Date.now(),
                  status: 'read'
              };
              
              setMessages(prev => ({
                  ...prev,
                  [username]: [...(prev[username] || []), joinMsg]
              }));
          }
      });

      // 2. Add to accounts list
      const newAccounts = [...accounts, newProfile];
      setAccounts(newAccounts);
      setUserProfile(newProfile);
      
      // Reset chats for new user
      setChats(INITIAL_CHATS);

      setShowRegistration(false);
      localStorage.setItem(STORAGE_KEYS.REGISTRATION, 'true');

      // Register with Server (Broadcast to LAN)
      if (socketRef.current) {
          socketRef.current.registerUser(newProfile);
      }
  };

  const toggleCallsView = () => {
      setShowCallsView(!showCallsView);
      if (!showCallsView) setShowArchiveView(false);
  };

  const toggleArchiveView = () => {
      setShowArchiveView(!showArchiveView);
      if (!showArchiveView) setShowCallsView(false);
  };

  const contactList = chats.filter(c => !c.isGroup && c.id !== '1' && !c.isBot); 
  const activeChat = chats.find(c => c.id === activeChatId);
  const visibleChats = chats.filter(c => showArchiveView ? archivedChatIds.has(c.id) : !archivedChatIds.has(c.id));
  const profileChat = viewingProfileId ? chats.find(c => c.id === viewingProfileId) : null;
  const takenUsernames = chats.map(c => c.username).filter(Boolean) as string[];

  // --- Render ---

  if (showRegistration) {
      return (
          <RegistrationScreen 
              onComplete={handleRegistrationComplete} 
              lang={lang}
              theme={currentTheme}
              socket={socketRef.current}
          />
      );
  }

  return (
    <div className={`flex h-screen w-screen overflow-hidden ${settings.theme === 'glass' ? 'bg-[#e0e0e0]' : 'bg-[#f2f2f7]'} font-sans text-gray-900 transition-colors duration-500`}>
      
      {/* Modals */}
      <AdminPanel 
          isOpen={showAdminPanel}
          onClose={() => setShowAdminPanel(false)}
          messages={adminMessages}
          isLoading={isLoadingAdmin}
          onRefresh={handleRefreshAdmin}
      />

      <SettingsModal 
        isOpen={showSettings}
        profile={userProfile}
        onClose={() => setShowSettings(false)}
        onSave={(newProfile) => setUserProfile(newProfile)}
        lang={lang}
        onSetLang={(l) => setSettings(s => ({...s, lang: l}))}
        currentTheme={themeKey}
        onSetTheme={(th) => setSettings(s => ({...s, theme: th}))}
      />

      <CreateGroupModal 
        isOpen={showCreateGroup}
        onClose={() => setShowCreateGroup(false)}
        onCreate={handleCreateGroup}
        contacts={contactList}
        lang={lang}
      />

      <AddContactModal 
          isOpen={showAddContact}
          onClose={() => setShowAddContact(false)}
          onAdd={handleAddNewContact}
          lang={lang}
          theme={currentTheme}
      />
      
      <PremiumModal 
          isOpen={showPremiumModal}
          onClose={() => setShowPremiumModal(false)}
          onSubscribe={handleBuyPremium}
          lang={lang}
          socket={socketRef.current}
          userId={userProfile.id}
      />

      {/* Sidebar - Hidden on mobile if chat is open */}
      <Sidebar 
        chats={visibleChats} 
        activeChatId={activeChatId} 
        onSelectChat={handleSelectChat}
        onAddChat={handleAddChat}
        className={`${activeChatId ? 'hidden md:flex' : 'flex'} w-full md:w-[320px] lg:w-[380px] shrink-0 z-20`} 
        userProfile={userProfile}
        accounts={accounts}
        onSwitchAccount={handleSwitchAccount}
        onOpenSettings={() => setShowSettings(true)}
        archivedCount={archivedChatIds.size}
        isArchiveView={showArchiveView}
        onToggleArchiveView={toggleArchiveView}
        onNewGroup={() => setShowCreateGroup(true)}
        onOpenAddContact={() => setShowAddContact(true)}
        lang={lang}
        theme={currentTheme}
        calls={calls}
        isCallsView={showCallsView}
        onToggleCallsView={toggleCallsView}
        onOpenPremium={() => setShowPremiumModal(true)}
        onOpenAdmin={handleOpenAdmin}
      />

      {/* Main Content Area */}
      <div className={`${!activeChatId ? 'hidden md:flex' : 'flex'} flex-1 h-full relative shadow-2xl`}>
        
        {activeChat ? (
            <div className="flex w-full h-full relative">
                {/* Chat Window */}
                <ChatWindow 
                    chat={activeChat}
                    messages={messages[activeChat.id] || []}
                    onBack={() => setActiveChatId(null)}
                    onOpenProfile={() => setViewingProfileId(activeChat.id)}
                    onSendMessage={handleSendMessage}
                    isTyping={typingMap[activeChat.id]}
                    className="flex-1"
                    lang={lang}
                    theme={currentTheme}
                    contacts={chats} // Pass all contacts for resolving sender IDs
                    onUserProfileClick={(id) => setViewingProfileId(id)}
                    accounts={accounts} // Pass accounts for premium status check
                    currentUser={userProfile} // Fix: Pass current user for correct "me/them" logic
                />

                {/* Profile Panel */}
                {profileChat && (
                    <div className="hidden lg:block w-[350px] shrink-0 border-l border-gray-200 z-10 relative">
                        <ProfilePanel 
                            chat={profileChat} 
                            onClose={() => setViewingProfileId(null)}
                            isArchived={archivedChatIds.has(profileChat.id)}
                            onToggleArchive={() => handleToggleArchive(profileChat.id)}
                            onDelete={() => handleDeleteChat(profileChat.id)}
                            onToggleMute={() => handleToggleMute(profileChat.id)}
                            onUpdateGroup={handleUpdateGroup}
                            onAddMember={(id) => handleAddMember(profileChat.id, id)}
                            lang={lang}
                            theme={currentTheme}
                            contacts={chats}
                            accounts={accounts}
                        />
                    </div>
                )}
                
                {/* Mobile/Tablet Overlay Profile */}
                {profileChat && (
                     <div className="absolute inset-0 z-50 lg:hidden bg-[#f2f2f7]">
                        <ProfilePanel 
                            chat={profileChat} 
                            onClose={() => setViewingProfileId(null)} 
                            isArchived={archivedChatIds.has(profileChat.id)}
                            onToggleArchive={() => handleToggleArchive(profileChat.id)}
                            onDelete={() => handleDeleteChat(profileChat.id)}
                            onToggleMute={() => handleToggleMute(profileChat.id)}
                            onUpdateGroup={handleUpdateGroup}
                            onAddMember={(id) => handleAddMember(profileChat.id, id)}
                            lang={lang}
                            theme={currentTheme}
                            contacts={chats}
                            accounts={accounts}
                        />
                     </div>
                )}
            </div>
        ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#f2f2f7]/50 backdrop-blur-3xl text-gray-400 select-none">
                <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 shadow-sm ${settings.theme === 'glass' ? 'bg-white/50 border border-white/60' : 'bg-gray-200'}`}>
                    <span className="text-4xl font-bold text-gray-400">RG</span>
                </div>
                <p className="bg-gray-200/50 px-6 py-2 rounded-full text-sm font-semibold">{t.selectChat}</p>
            </div>
        )}
      </div>
    </div>
  );
};

export default App;
