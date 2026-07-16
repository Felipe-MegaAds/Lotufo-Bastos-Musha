/* ==========================================================================
   LÓGICA DO CHATBOT CONVERSACIONAL — LBM ADVOGADOS
   Funcionalidades:
     1. Captura e persistência de UTMs/Ad IDs no LocalStorage.
     2. Gerenciamento do fluxo de conversação (máquina de estados).
     3. Validações robustas no front-end (E-mail, WhatsApp com máscara, CPF com dígito verificador).
     4. Envio parcial e final de leads para o CRM (Webhook).
     5. Integração com dataLayer do GTM para eventos (step_view, step_complete, lead_submit).
     6. Cálculo de temperatura de leads (Lead Scoring).
     7. Handoff personalizado para WhatsApp ao final do fluxo.
   ========================================================================== */

// --- CONFIGURAÇÕES DO CRM E CONTATO ---
// Webhook para envio de dados do lead (ActiveCampaign, n8n, etc.)
// O time de marketing pode configurar esta URL para integração direta.
const CRM_WEBHOOK_URL = ''; 

// Número de atendimento do WhatsApp da Lotufo Advocacia
const WHATSAPP_NUMERO = '5511943099915';

// Lista de doenças oficiais da Lei 7.713/88 com os CIDs internos
const DOENCAS_OFICIAIS = [
    { nome: "Neoplasia Maligna / Câncer", cid: "C00–C97" },
    { nome: "Cardiopatia Grave", cid: "I00–I99" },
    { nome: "Doença de Parkinson", cid: "G20" },
    { nome: "Alienação Mental / Alzheimer", cid: "F00–F99" },
    { nome: "Nefropatia Grave / Doença renal", cid: "N17–N19" },
    { nome: "Hepatopatia Grave / Fígado", cid: "K70–K77" },
    { nome: "Paralisia irreversível e incapacitante", cid: "G80–G83" },
    { nome: "Cegueira, inclusive monocular", cid: "H54" },
    { nome: "Esclerose Múltipla", cid: "G35" },
    { nome: "Tuberculose Ativa", cid: "A15–A19" },
    { nome: "AIDS/HIV", cid: "B20–B24" },
    { nome: "Hanseníase", cid: "A30" },
    { nome: "Espondiloartrose Anquilosante", cid: "M45" },
    { nome: "Doença de Paget avançada", cid: "M88" },
    { nome: "Contaminação por radiação", cid: "W88–W90" },
    { nome: "Moléstia profissional/ocupacional", cid: "Z57" }
];

// --- VARIÁVEIS DE ESTADO E PERSISTÊNCIA ---
let dadosLead = {
    perfil: '',
    desconta_ir: '',
    doenca: '',
    doenca_outra: false,
    nome: '',
    tem_laudo: '',
    faixa_renda: '',
    faixa_ate5k_detalhe: '',
    regime: '',
    ano_diagnostico: '',
    email: '',
    whatsapp: '',
    intencao: '',
    cpf: '',
    cpf_valido: false,
    lead_score: ''
};

// --- FUNÇÃO PARA CAPTURAR E PERSISTIR UTMs ---
// Coleta os parâmetros de URL e salva no LocalStorage para rastreamento de campanhas
function capturarPersistirUTMs() {
    const params = new URLSearchParams(window.location.search);
    const chavesUTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid'];
    
    chavesUTM.forEach(chave => {
        const valor = params.get(chave);
        if (valor) {
            // Salva no LocalStorage para persistir em futuras visitas
            localStorage.setItem(chave, valor);
            
            // Salva em cookie de fallback com expiração de 30 dias
            const d = new Date();
            d.setTime(d.getTime() + (30*24*60*60*1000));
            document.cookie = `${chave}=${valor};expires=${d.toUTCString()};path=/`;
        }
    });
}

// Obtém o valor de uma UTM armazenada
function obterUTM(chave) {
    return localStorage.getItem(chave) || getCookie(chave) || '';
}

// Helper para ler cookies
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return '';
}

// --- INTEGRAÇÕES DE ANÁLISE (GTM & CRM) ---

// Dispara eventos na camada de dados (dataLayer) para o GTM monitorar conversões
function enviarGTM(nomeEvento, parametros = {}) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
        event: nomeEvento,
        ...parametros
    });
}

// Envia os dados do lead coletados até o momento de forma assíncrona ao CRM
function enviarLeadAoCRM(tipoEnvio = "parcial") {
    // Coleta as UTMs persistidas
    const utms = {
        utm_source: obterUTM('utm_source'),
        utm_medium: obterUTM('utm_medium'),
        utm_campaign: obterUTM('utm_campaign'),
        utm_term: obterUTM('utm_term'),
        utm_content: obterUTM('utm_content'),
        gclid: obterUTM('gclid'),
        gbraid: obterUTM('gbraid')
    };

    const payload = {
        ...dadosLead,
        ...utms,
        tipo_envio: tipoEnvio,
        data_cadastro: new Date().toISOString(),
        url_origem: window.location.href
    };

    console.log(`[CRM] Enviando payload (${tipoEnvio}):`, payload);

    if (CRM_WEBHOOK_URL) {
        fetch(CRM_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            mode: 'cors'
        })
        .then(response => {
            if (!response.ok) {
                console.warn('[CRM] Erro na resposta do webhook:', response.status);
            }
        })
        .catch(error => {
            console.error('[CRM] Erro ao disparar envio para o webhook:', error);
        });
    }
}

// --- MÁQUINA DE ESTADOS DO CHAT ---
// Estrutura das etapas do fluxo conversacional
const chatState = {
    currentNode: 'N0',
    messagesContainer: null,
    inputPanel: null,
    progressBar: null,
    progressText: null
};

// Mapeamento de passos para a barra de progresso (para calcular o percentual)
const totalPassosEstimados = 10;
const mapeamentoPassos = {
    'N0': 0, 'N1': 1, 'N2': 2, 'N3': 3, 'N4': 4,
    'N5': 5, 'N6': 6, 'N6-A': 7, 'N6-C': 8, 'N7': 9,
    'N8': 10, 'N9': 10, 'N10': 10, 'N11': 10
};

// Inicializa a interface do chatbot conversacional
function inicializarChatbot() {
    chatState.messagesContainer = document.getElementById('lbm-chat-messages');
    chatState.inputPanel = document.getElementById('lbm-chat-inputs');
    chatState.progressBar = document.getElementById('lbm-chat-progress-bar');
    chatState.progressText = document.getElementById('lbm-chat-progress-text');
    
    // Captura e armazena os UTMs da visita atual
    capturarPersistirUTMs();
    
    // Limpa a tela e reseta as variáveis do lead
    chatState.currentNode = 'N0';
    chatState.messagesContainer.innerHTML = '';
    dadosLead = {
        perfil: '', desconta_ir: '', doenca: '', doenca_outra: false,
        nome: '', tem_laudo: '', faixa_renda: '', faixa_ate5k_detalhe: '',
        regime: '', ano_diagnostico: '', email: '', whatsapp: '',
        intencao: '', cpf: '', cpf_valido: false, lead_score: ''
    };

    // Abre o chat em tela cheia de forma visível
    const overlay = document.getElementById('lbm-chat-overlay');
    if (overlay) {
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // Impede rolagem da LP de fundo
    }

    // Executa a primeira etapa do fluxo
    processarNoAtual();
}

// Atualiza a barra de progresso visual no topo da janela do chat
function atualizarProgresso(no) {
    const passoAtual = mapeamentoPassos[no] || 0;
    const porcentagem = Math.min(Math.round((passoAtual / totalPassosEstimados) * 100), 100);
    
    if (chatState.progressBar) {
        chatState.progressBar.style.width = `${porcentagem}%`;
    }
    if (chatState.progressText) {
        chatState.progressText.textContent = `Passo ${passoAtual} de ${totalPassosEstimados}`;
    }
}

// Limpa o painel de input e renderiza o indicador de digitação da "Ana"
function mostrarIndicadorDigitando(callback) {
    chatState.inputPanel.innerHTML = '';
    
    const row = document.createElement('div');
    row.className = 'chat-message-row bot typing-indicator-row';
    row.innerHTML = `
        <div class="typing-indicator-bubble">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        </div>
    `;
    
    chatState.messagesContainer.appendChild(row);
    chatState.messagesContainer.scrollTop = chatState.messagesContainer.scrollHeight;

    // Tempo realista de digitação (1.2 segundos) para humanizar
    setTimeout(() => {
        const indicador = chatState.messagesContainer.querySelector('.typing-indicator-row');
        if (indicador) {
            chatState.messagesContainer.removeChild(indicador);
        }
        callback();
    }, 1200);
}

// Adiciona uma mensagem de texto no histórico do chat
function adicionarMensagem(autor, texto) {
    const row = document.createElement('div');
    row.className = `chat-message-row ${autor}`;
    row.innerHTML = `<div class="chat-bubble">${texto}</div>`;
    chatState.messagesContainer.appendChild(row);
    chatState.messagesContainer.scrollTop = chatState.messagesContainer.scrollHeight;
}

// Controla o fluxo de navegação baseado no Nó de estado atual
function processarNoAtual() {
    const no = chatState.currentNode;
    atualizarProgresso(no);
    
    // Notifica visualizações de passo para o GTM
    enviarGTM('step_view', { no_atual: no });

    switch (no) {
        case 'N0':
            mostrarIndicadorDigitando(() => {
                // Mensagem de boas-vindas atualizada com o novo nome do escritório
                adicionarMensagem('bot', "Olá! Eu sou a Ana, consultora da <strong>LBM Advogados</strong>. 👋");
                setTimeout(() => {
                    adicionarMensagem('bot', "Vou te ajudar a descobrir, em menos de 2 minutos e sem custo, se você tem direito a <strong>parar de pagar Imposto de Renda</strong> e a <strong>receber de volta</strong> o que pagou nos últimos 5 anos.");
                    setTimeout(() => {
                        chatState.currentNode = 'N1';
                        processarNoAtual();
                    }, 800);
                }, 1000);
            });
            break;
            
        case 'N1':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', "Para começar: qual é a sua situação hoje?");
                
                const opcoes = [
                    { texto: "Sou aposentado(a)", valor: "aposentado" },
                    { texto: "Recebo pensão", valor: "pensionista" },
                    { texto: "Sou militar reformado / reserva remunerada", valor: "reformado_militar" },
                    { texto: "Nenhuma dessas opções", valor: "nenhum" }
                ];
                
                renderizarOpcoesBotoes(opcoes, (escolha) => {
                    dadosLead.perfil = escolha.valor;
                    adicionarMensagem('user', escolha.texto);
                    enviarGTM('step_complete', { no_completo: 'N1', escolha: escolha.valor });

                    if (escolha.valor === 'nenhum') {
                        chatState.currentNode = 'N1-R';
                    } else {
                        chatState.currentNode = 'N2';
                    }
                    setTimeout(processarNoAtual, 600);
                });
            });
            break;
            
        case 'N1-R':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', "Entendi. A isenção por doença grave vale <strong>especificamente</strong> para aposentados, pensionistas e militares reformados.");
                setTimeout(() => {
                    adicionarMensagem('bot', "Mas você pode ajudar alguém: conhece alguém aposentado ou pensionista que ainda paga IR e tem (ou já teve) uma doença grave? Compartilhe este simulador com ela. 💙");
                    
                    renderizarFormularioN1R();
                }, 1000);
            });
            break;
            
        case 'N2':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', "Perfeito! Hoje é descontado algum valor de <strong>Imposto de Renda</strong> da sua aposentadoria/pensão/reforma?");
                
                const opcoes = [
                    { texto: "Sim, é descontado", valor: "true" },
                    { texto: "Não é descontado", valor: "false" },
                    { texto: "Não tenho certeza", valor: "nao_sei" }
                ];
                
                renderizarOpcoesBotoes(opcoes, (escolha) => {
                    dadosLead.desconta_ir = escolha.valor;
                    adicionarMensagem('user', escolha.texto);
                    enviarGTM('step_complete', { no_completo: 'N2', escolha: escolha.valor });
                    
                    chatState.currentNode = 'N3';
                    setTimeout(processarNoAtual, 600);
                });
            });
            break;
            
        case 'N3':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', "Tudo bem. Agora o ponto principal: você tem ou já teve (mesmo que já curado) alguma destas condições?");
                
                renderizarGridDoencas((doencaEscolhida) => {
                    adicionarMensagem('user', doencaEscolhida.nome);
                    enviarGTM('step_complete', { no_completo: 'N3', escolha: doencaEscolhida.nome });

                    if (doencaEscolhida.cid === 'outra') {
                        dadosLead.doenca_outra = true;
                        chatState.currentNode = 'N3-O';
                    } else {
                        dadosLead.doenca = `${doencaEscolhida.nome} (${doencaEscolhida.cid})`;
                        dadosLead.doenca_outra = false;
                        chatState.currentNode = 'N4';
                    }
                    setTimeout(processarNoAtual, 600);
                });
            });
            break;
            
        case 'N3-O':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', "A lista da lei é a base, mas a <strong>jurisprudência</strong> já garantiu isenção em vários casos fora da lista oficial. Vale a pena um advogado analisar o seu caso de perto.");
                setTimeout(() => {
                    adicionarMensagem('bot', "Me conte rapidamente: qual é a sua condição de saúde ou diagnóstico?");
                    
                    renderizarInputTexto("Ex: Cardiopatia congênita, Parkinsonismo precoce...", "Avançar", (textoDigitado) => {
                        dadosLead.doenca = textoDigitado;
                        dadosLead.lead_score = 'frio'; // Fora da lista principal é marcado como frio
                        adicionarMensagem('user', textoDigitado);
                        enviarGTM('step_complete', { no_completo: 'N3-O', valor: textoDigitado });
                        
                        chatState.currentNode = 'N4';
                        setTimeout(processarNoAtual, 600);
                    });
                }, 1000);
            });
            break;
            
        case 'N4':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', "Ótimo, já temos um bom caminho aqui. Como você se chama? (digite apenas o seu <strong>primeiro nome</strong>)");
                
                renderizarInputTexto("Digite seu primeiro nome...", "Avançar", (nomeDigitado) => {
                    dadosLead.nome = nomeDigitado.trim();
                    adicionarMensagem('user', dadosLead.nome);
                    enviarGTM('step_complete', { no_completo: 'N4', valor: dadosLead.nome });
                    
                    mostrarIndicadorDigitando(() => {
                        adicionarMensagem('bot', `Prazer, <strong>${dadosLead.nome}</strong>! A partir de agora vou personalizar a sua análise.`);
                        setTimeout(() => {
                            chatState.currentNode = 'N5';
                            processarNoAtual();
                        }, 800);
                    });
                });
            });
            break;
            
        case 'N5':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', `${dadosLead.nome}, você já tem em mãos algum <strong>laudo, biópsia ou relatório médico</strong> que comprove essa condição? (Pode ser de qualquer data, mesmo antigo, de médico particular ou público)`);
                
                const opcoes = [
                    { texto: "Sim, tenho em mãos", valor: "sim" },
                    { texto: "Ainda não tenho", valor: "nao_ainda" }
                ];
                
                renderizarOpcoesBotoes(opcoes, (escolha) => {
                    dadosLead.tem_laudo = escolha.valor;
                    adicionarMensagem('user', escolha.texto);
                    enviarGTM('step_complete', { no_completo: 'N5', escolha: escolha.valor });
                    
                    mostrarIndicadorDigitando(() => {
                        if (escolha.valor === 'sim') {
                            adicionarMensagem('bot', "Excelente — isso acelera muito o seu caso!");
                        } else {
                            adicionarMensagem('bot', "Sem problema. Nós te orientamos exatamente como conseguir o laudo de forma rápida. Isso não impede de começarmos.");
                        }
                        
                        setTimeout(() => {
                            chatState.currentNode = 'N6';
                            processarNoAtual();
                        }, 1000);
                    });
                });
            });
            break;
            
        case 'N6':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', "Para eu estimar o benefício financeiro, em qual faixa está a sua <strong>renda bruta mensal</strong> de aposentadoria/pensão?");
                
                const opcoesRenda = [
                    { texto: "Até R$ 5.000", valor: "ate_5k" },
                    { texto: "De R$ 5.000 a R$ 7.350", valor: "5k_7350" },
                    { texto: "De R$ 7.350 a R$ 10.000", valor: "7350_10k" },
                    { texto: "Acima de R$ 10.000", valor: "acima_10k" }
                ];
                
                renderizarOpcoesBotoes(opcoesRenda, (escolhaRenda) => {
                    dadosLead.faixa_renda = escolhaRenda.valor;
                    adicionarMensagem('user', `Renda: ${escolhaRenda.texto}`);
                    enviarGTM('step_complete', { no_completo: 'N6_renda', escolha: escolhaRenda.valor });
                    
                    // Emenda a pergunta de Regime Previdenciário imediatamente
                    setTimeout(() => {
                        mostrarIndicadorDigitando(() => {
                            adicionarMensagem('bot', "E a sua aposentadoria/pensão é paga por qual regime?");
                            
                            const opcoesRegime = [
                                { texto: "INSS (Regime Geral)", valor: "inss" },
                                { texto: "Servidor Público (RPPS)", valor: "rpps" },
                                { texto: "Militar (Forças Armadas)", valor: "militar" },
                                { texto: "Previdência Privada / Complementar", valor: "privada" }
                            ];
                            
                            renderizarOpcoesBotoes(opcoesRegime, (escolhaRegime) => {
                                dadosLead.regime = escolhaRegime.valor;
                                adicionarMensagem('user', `Regime: ${escolhaRegime.texto}`);
                                enviarGTM('step_complete', { no_completo: 'N6_regime', escolha: escolhaRegime.valor });
                                
                                // Mensagens de valor de acordo com a faixa de renda
                                mostrarIndicadorDigitando(() => {
                                    if (dadosLead.faixa_renda === 'ate_5k') {
                                        // Encaminha direto para sub-verificação sem mostrar mensagem de valor
                                        chatState.currentNode = 'N6-A';
                                        processarNoAtual();
                                    } else {
                                        if (dadosLead.faixa_renda === '5k_7350') {
                                            adicionarMensagem('bot', "Nessa faixa você tem desconto <strong>parcial</strong> na tabela nova. Mas a isenção por doença grave é <strong>total e mais vantajosa</strong> — e ainda garante a restituição dos últimos 5 anos.");
                                        } else {
                                            adicionarMensagem('bot', `O valor da sua isenção mensal é <strong>bem expressivo</strong>, ${dadosLead.nome}. Além de parar de pagar IR sobre 100% dos proventos, você tem direito à <strong>restituição retroativa</strong> dos últimos 5 anos corrigida pela Selic.`);
                                        }
                                        setTimeout(() => {
                                            chatState.currentNode = 'N6-C';
                                            processarNoAtual();
                                        }, 1200);
                                    }
                                });
                            });
                        });
                    }, 600);
                });
            });
            break;
            
        case 'N6-A':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', `Só para eu confirmar, ${dadosLead.nome}: a sua aposentadoria/pensão está acima ou abaixo de <strong>R$ 3.000 por mês</strong>?`);
                
                const opcoes = [
                    { texto: "Acima de R$ 3.000 (entre 3k e 5k)", valor: "entre_3k_5k" },
                    { texto: "Abaixo de R$ 3.000", valor: "abaixo_3k" }
                ];
                
                renderizarOpcoesBotoes(opcoes, (escolha) => {
                    dadosLead.faixa_ate5k_detalhe = escolha.valor;
                    adicionarMensagem('user', escolha.texto);
                    enviarGTM('step_complete', { no_completo: 'N6-A', escolha: escolha.valor });
                    
                    mostrarIndicadorDigitando(() => {
                        if (escolha.valor === 'entre_3k_5k') {
                            adicionarMensagem('bot', "Ótimo. Pela tabela nova de 2026 você já está isento hoje, mas nos anos anteriores você pagou IR — e tem direito de receber esses valores de volta, dos últimos 5 anos, corrigidos pela Selic.");
                            setTimeout(() => {
                                chatState.currentNode = 'N6-C';
                                processarNoAtual();
                            }, 1200);
                        } else {
                            // Abaixo de R$ 3.000
                            // Se em N2 o usuário respondeu desconta_ir = true (erro da fonte pagadora, viável para cessar e restituir)
                            if (dadosLead.desconta_ir === 'true') {
                                adicionarMensagem('bot', "Perfeito. Embora a renda seja inferior a R$ 3.000, como você confirmou que possui desconto ativo em folha, há um caso viável para cessar esses descontos e buscar a restituição.");
                                setTimeout(() => {
                                    chatState.currentNode = 'N6-C';
                                    processarNoAtual();
                                }, 1200);
                            } else {
                                // Rota honesta sem desconto ativo
                                chatState.currentNode = 'N6-A-R';
                                processarNoAtual();
                            }
                        }
                    });
                });
            });
            break;
            
        case 'N6-A-R':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', `${dadosLead.nome}, vou ser transparente com você. Com a tabela de 2026, uma renda nessa faixa já é isenta hoje — então, olhando para frente, a isenção por doença não muda o seu desconto mensal (ele já é zero).`);
                setTimeout(() => {
                    adicionarMensagem('bot', "O que você ainda pode ter direito é de receber de volta o IR que pagou nos últimos 5 anos. Só que, numa renda abaixo de R$ 3.000, esse valor costuma ser baixo — e se você tiver 65 anos ou mais, muito provavelmente já não pagava nada por conta da isenção extra de idade.");
                    setTimeout(() => {
                        adicionarMensagem('bot', "Mesmo assim, se você teve desconto de IR nesses anos, dá para analisar. Como você prefere seguir?");
                        
                        const opcoes = [
                            { texto: "Tive desconto de IR e quero analisar", valor: "analisar" },
                            { texto: "Acho que não paguei / prefiro não seguir", valor: "cancelar" }
                        ];
                        
                        renderizarOpcoesBotoes(opcoes, (escolha) => {
                            adicionarMensagem('user', escolha.texto);
                            enviarGTM('step_complete', { no_completo: 'N6-A-R', escolha: escolha.valor });
                            
                            if (escolha.valor === 'analisar') {
                                dadosLead.lead_score = 'baixo_valor';
                                chatState.currentNode = 'N7';
                                setTimeout(processarNoAtual, 600);
                            } else {
                                mostrarIndicadorDigitando(() => {
                                    adicionarMensagem('bot', `Sem problema, ${dadosLead.nome}. Se você conhece algum aposentado ou pensionista com renda maior e doença grave que ainda paga IR, compartilhe este simulador — nesses casos o valor recuperado é muito maior. ❤️`);
                                    
                                    renderizarFormularioN6AR();
                                });
                            }
                        });
                    }, 1200);
                }, 1200);
            });
            break;
            
        case 'N6-C':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', "Só mais um detalhe que ajuda a calcular seu retroativo: em que <strong>ano</strong> você recebeu o diagnóstico da doença? (se não lembrar, pode pular)");
                
                renderizarInputNumeroOpcional("Ex: 2022", "Avançar", (anoDigitado) => {
                    dadosLead.ano_diagnostico = anoDigitado;
                    if (anoDigitado) {
                        adicionarMensagem('user', `Diagnóstico em ${anoDigitado}`);
                        enviarGTM('step_complete', { no_completo: 'N6-C', valor: anoDigitado });
                    } else {
                        adicionarMensagem('user', 'Pulei este passo');
                        enviarGTM('step_complete', { no_completo: 'N6-C', valor: 'pulado' });
                    }
                    
                    chatState.currentNode = 'N7';
                    setTimeout(processarNoAtual, 600);
                });
            });
            break;
            
        case 'N7':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', `${dadosLead.nome}, vou preparar a sua análise detalhada e te enviar tudo por escrito. Qual é o seu <strong>melhor e-mail</strong>?`);
                
                renderizarInputEmail((emailDigitado) => {
                    dadosLead.email = emailDigitado.trim();
                    adicionarMensagem('user', dadosLead.email);
                    enviarGTM('step_complete', { no_completo: 'N7', valor: dadosLead.email });
                    
                    // DISPARO DE PERSISTÊNCIA PARCIAL 1 (CRM)
                    enviarLeadAoCRM("parcial_email");
                    
                    chatState.currentNode = 'N8';
                    setTimeout(processarNoAtual, 600);
                });
            });
            break;
            
        case 'N8':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', "Para terminar, me passe o seu número de <strong>celular com WhatsApp</strong> — é por ele que nosso advogado falará com você.");
                
                renderizarInputTelefone((telefoneDigitado) => {
                    dadosLead.whatsapp = telefoneDigitado;
                    adicionarMensagem('user', telefoneDigitado);
                    enviarGTM('step_complete', { no_completo: 'N8', valor: telefoneDigitado });
                    
                    // DISPARO DE PERSISTÊNCIA PARCIAL 2 (CRM)
                    enviarLeadAoCRM("parcial_whatsapp");
                    
                    chatState.currentNode = 'N9';
                    setTimeout(processarNoAtual, 600);
                });
            });
            break;
            
        case 'N9':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', "Antes de te encaminhar para o atendimento: qual é o seu principal objetivo agora?");
                
                const opcoes = [
                    { texto: "Quero garantir meu direito o quanto antes", valor: "quero_direito" },
                    { texto: "Só quero obter informações por enquanto", valor: "quero_informacao" }
                ];
                
                renderizarOpcoesBotoes(opcoes, (escolha) => {
                    dadosLead.intencao = escolha.valor;
                    adicionarMensagem('user', escolha.texto);
                    enviarGTM('step_complete', { no_completo: 'N9', escolha: escolha.valor });
                    
                    chatState.currentNode = 'N10';
                    setTimeout(processarNoAtual, 600);
                });
            });
            break;
            
        case 'N10':
            mostrarIndicadorDigitando(() => {
                adicionarMensagem('bot', "Para agilizar o seu atendimento e a pesquisa do seu benefício, quer já informar o seu <strong>CPF</strong>? (Opcional — você pode pular e informar depois)");
                
                renderizarInputCpfOpcional((cpfDigitado, cpfEhValido) => {
                    dadosLead.cpf = cpfDigitado;
                    dadosLead.cpf_valido = cpfEhValido;
                    
                    if (cpfDigitado) {
                        adicionarMensagem('user', `CPF: ${cpfDigitado}`);
                        enviarGTM('step_complete', { no_completo: 'N10', valor: 'preenchido', valido: cpfEhValido });
                    } else {
                        adicionarMensagem('user', 'Pulei este passo');
                        enviarGTM('step_complete', { no_completo: 'N10', valor: 'pulado' });
                    }
                    
                    // CALCULAR TEMPERATURA E FINALIZAR FLUXO
                    calcularLeadScore();
                    
                    // DISPARO DE LEAD COMPLETO (CRM)
                    enviarLeadAoCRM("completo");
                    
                    // Notifica lead_submit no GTM
                    enviarGTM('lead_submit', {
                        lead_score: dadosLead.lead_score,
                        faixa_renda: dadosLead.faixa_renda,
                        regime: dadosLead.regime
                    });

                    chatState.currentNode = 'N11';
                    setTimeout(processarNoAtual, 800);
                });
            });
            break;
            
        case 'N11':
            mostrarIndicadorDigitando(() => {
                renderizarTelaFinalDeSucesso();
            });
            break;
    }
}

// --- RENDERS DE COMPONENTES DE INTERAÇÃO (DOM) ---

// Renderiza botões simples de múltipla escolha
function renderizarOpcoesBotoes(opcoes, callback) {
    chatState.inputPanel.innerHTML = '';
    
    const container = document.createElement('div');
    container.className = 'chat-options-container';
    
    opcoes.forEach(opcao => {
        const btn = document.createElement('button');
        btn.className = 'chat-option-btn';
        btn.innerHTML = `<span>${opcao.texto}</span>`;
        btn.addEventListener('click', () => callback(opcao));
        container.appendChild(btn);
    });
    
    chatState.inputPanel.appendChild(container);
}

// Renderiza o grid compacto com as 16 doenças + outra
function renderizarGridDoencas(callback) {
    chatState.inputPanel.innerHTML = '';
    
    const grid = document.createElement('div');
    grid.className = 'chat-diseases-grid';
    
    DOENCAS_OFICIAIS.forEach(doenca => {
        const btn = document.createElement('button');
        btn.className = 'chat-disease-option';
        btn.textContent = doenca.nome;
        btn.addEventListener('click', () => callback(doenca));
        grid.appendChild(btn);
    });
    
    // Adiciona a opção de "Outra doença"
    const btnOutra = document.createElement('button');
    btnOutra.className = 'chat-disease-option';
    btnOutra.style.gridColumn = '1 / -1';
    btnOutra.style.backgroundColor = 'rgba(204, 166, 80, 0.1)';
    btnOutrd = '1.5px solid rgba(204, 166, 80, 0.4)';
    btnOutra.textContent = "Outra doença / não sei se a minha entra";
    btnOutra.addEventListener('click', () => callback({ nome: "Outra condição", cid: "outra" }));
    grid.appendChild(btnOutra);
    
    chatState.inputPanel.appendChild(grid);
}

// Renderiza input de texto geral com validação
function renderizarInputTexto(placeholder, txtBotao, callback) {
    chatState.inputPanel.innerHTML = '';
    
    const container = document.createElement('div');
    container.className = 'chat-form-container';
    
    container.innerHTML = `
        <div class="chat-input-wrapper">
            <input type="text" class="chat-text-input" placeholder="${placeholder}" id="chat-text-field" required />
        </div>
        <button class="chat-submit-btn" id="chat-submit-field" disabled>${txtBotao}</button>
    `;
    
    chatState.inputPanel.appendChild(container);
    
    const input = document.getElementById('chat-text-field');
    const btn = document.getElementById('chat-submit-field');
    
    // Foca automaticamente no campo
    input.focus();
    
    input.addEventListener('input', () => {
        btn.disabled = input.value.trim().length < 2;
    });
    
    const enviar = () => {
        if (input.value.trim().length >= 2) {
            callback(input.value.trim());
        }
    };
    
    btn.addEventListener('click', enviar);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            enviar();
        }
    });
}

// Renderiza campo numérico opcional (ex: Ano Diagnóstico) com botão Pular
function renderizarInputNumeroOpcional(placeholder, txtBotao, callback) {
    chatState.inputPanel.innerHTML = '';
    
    const container = document.createElement('div');
    container.className = 'chat-form-container';
    
    container.innerHTML = `
        <div class="chat-input-wrapper">
            <input type="number" class="chat-text-input" placeholder="${placeholder}" id="chat-num-field" min="1950" max="2026" />
        </div>
        <div class="chat-btn-row">
            <button class="chat-skip-btn" id="chat-skip-num">Pular</button>
            <button class="chat-submit-btn" id="chat-submit-num" disabled>${txtBotao}</button>
        </div>
    `;
    
    chatState.inputPanel.appendChild(container);
    
    const input = document.getElementById('chat-num-field');
    const btn = document.getElementById('chat-submit-num');
    const skip = document.getElementById('chat-skip-num');
    
    input.focus();
    
    input.addEventListener('input', () => {
        const val = parseInt(input.value);
        const anoAtual = new Date().getFullYear();
        btn.disabled = isNaN(val) || val < 1950 || val > anoAtual;
    });
    
    btn.addEventListener('click', () => callback(input.value));
    skip.addEventListener('click', () => callback(''));
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!btn.disabled) callback(input.value);
        }
    });
}

// Renderiza campo de e-mail com validação via RegExp
function renderizarInputEmail(callback) {
    chatState.inputPanel.innerHTML = '';
    
    const container = document.createElement('div');
    container.className = 'chat-form-container';
    
    container.innerHTML = `
        <div class="chat-input-wrapper">
            <input type="email" class="chat-text-input" placeholder="seuemail@exemplo.com" id="chat-email-field" required />
            <div class="chat-input-error-msg" id="chat-email-error">Por favor, insira um e-mail válido.</div>
        </div>
        <button class="chat-submit-btn" id="chat-submit-email" disabled>Avançar</button>
        <div class="chat-lgpd-disclaimer">
            Seus dados estão protegidos. Ao clicar em Avançar você concorda com nossa <a href="https://trabalhista.lbmlaw.com.br/politica-de-privacidade/" target="_blank">Política de Privacidade</a>.
        </div>
    `;
    
    chatState.inputPanel.appendChild(container);
    
    const input = document.getElementById('chat-email-field');
    const btn = document.getElementById('chat-submit-email');
    const errorEl = document.getElementById('chat-email-error');
    
    input.focus();
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    input.addEventListener('input', () => {
        const valido = emailRegex.test(input.value.trim());
        btn.disabled = !valido;
        if (input.value.length > 5 && !valido) {
            errorEl.style.display = 'block';
        } else {
            errorEl.style.display = 'none';
        }
    });
    
    const enviar = () => {
        if (emailRegex.test(input.value.trim())) {
            callback(input.value.trim());
        }
    };
    
    btn.addEventListener('click', enviar);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            enviar();
        }
    });
}

// Renderiza campo de telefone com máscara automática e validação de DDD + 9 dígitos
function renderizarInputTelefone(callback) {
    chatState.inputPanel.innerHTML = '';
    
    const container = document.createElement('div');
    container.className = 'chat-form-container';
    
    container.innerHTML = `
        <div class="chat-input-wrapper">
            <input type="tel" class="chat-text-input" placeholder="(11) 99999-9999" id="chat-phone-field" maxlength="15" required />
            <div class="chat-input-error-msg" id="chat-phone-error">Por favor, digite seu WhatsApp completo com DDD.</div>
        </div>
        <button class="chat-submit-btn" id="chat-submit-phone" disabled>Concluir Simulação</button>
        <div class="chat-lgpd-disclaimer">
            Autorizo o contato e o tratamento dos meus dados conforme a Política de Privacidade.
        </div>
    `;
    
    chatState.inputPanel.appendChild(container);
    
    const input = document.getElementById('chat-phone-field');
    const btn = document.getElementById('chat-submit-phone');
    const errorEl = document.getElementById('chat-phone-error');
    
    input.focus();
    
    // Máscara automática de telefone (11) 99999-9999
    input.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, "");
        if (value.length > 11) value = value.slice(0, 11);
        
        if (value.length > 10) {
            // Celular: (XX) XXXXX-XXXX
            value = `(${value.slice(0, 2)}) ${value.slice(2, 7)}-${value.slice(7)}`;
        } else if (value.length > 6) {
            value = `(${value.slice(0, 2)}) ${value.slice(2, 6)}-${value.slice(6)}`;
        } else if (value.length > 2) {
            value = `(${value.slice(0, 2)}) ${value.slice(2)}`;
        } else if (value.length > 0) {
            value = `(${value}`;
        }
        
        e.target.value = value;
        
        // Verifica se tem os 11 dígitos numéricos necessários
        const digitosApenas = e.target.value.replace(/\D/g, "");
        const valido = digitosApenas.length === 11;
        btn.disabled = !valido;
        
        if (digitosApenas.length > 2 && digitosApenas.length < 11) {
            errorEl.style.display = 'block';
        } else {
            errorEl.style.display = 'none';
        }
    });
    
    const enviar = () => {
        const digitosApenas = input.value.replace(/\D/g, "");
        if (digitosApenas.length === 11) {
            // Normaliza em formato E.164 nacional (+55XXXXXXXXXXX)
            callback(`+55${digitosApenas}`);
        }
    };
    
    btn.addEventListener('click', enviar);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            enviar();
        }
    });
}

// Renderiza campo de CPF opcional com máscara e validação matemática de dígito verificador
// OBS: De acordo com a regra crítica do dev, se a validação falhar, o avanço NÃO deve ser bloqueado.
function renderizarInputCpfOpcional(callback) {
    chatState.inputPanel.innerHTML = '';
    
    const container = document.createElement('div');
    container.className = 'chat-form-container';
    
    container.innerHTML = `
        <div class="chat-input-wrapper">
            <input type="text" class="chat-text-input" placeholder="000.000.000-00" id="chat-cpf-field" maxlength="14" />
            <div class="chat-input-error-msg" id="chat-cpf-error" style="color:#FFA726;">CPF inválido (não impede o avanço, clique em Enviar mesmo assim).</div>
        </div>
        <div class="chat-btn-row">
            <button class="chat-skip-btn" id="chat-skip-cpf">Pular</button>
            <button class="chat-submit-btn" id="chat-submit-cpf">Enviar e Finalizar</button>
        </div>
    `;
    
    chatState.inputPanel.appendChild(container);
    
    const input = document.getElementById('chat-cpf-field');
    const btn = document.getElementById('chat-submit-cpf');
    const skip = document.getElementById('chat-skip-cpf');
    const errorEl = document.getElementById('chat-cpf-error');
    
    input.focus();
    
    // Máscara automática de CPF 000.000.000-00
    input.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, "");
        if (value.length > 11) value = value.slice(0, 11);
        
        if (value.length > 9) {
            value = `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}`;
        } else if (value.length > 6) {
            value = `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6)}`;
        } else if (value.length > 3) {
            value = `${value.slice(0, 3)}.${value.slice(3)}`;
        }
        
        e.target.value = value;
        
        const digitos = e.target.value.replace(/\D/g, "");
        if (digitos.length > 0 && digitos.length < 11) {
            errorEl.style.display = 'none';
        } else if (digitos.length === 11) {
            const ehValido = validarCPF(digitos);
            errorEl.style.display = ehValido ? 'none' : 'block';
        } else {
            errorEl.style.display = 'none';
        }
    });
    
    const enviar = () => {
        const digitos = input.value.replace(/\D/g, "");
        if (digitos.length === 0) {
            callback('', false);
        } else {
            const ehValido = validarCPF(digitos);
            callback(input.value, ehValido);
        }
    };
    
    btn.addEventListener('click', enviar);
    skip.addEventListener('click', () => callback('', false));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            enviar();
        }
    });
}

// Algoritmo matemático para validação dos dígitos verificadores do CPF
function validarCPF(cpf) {
    if (cpf.length !== 11 || /^(\h)\1{10}$/.test(cpf)) return false;
    
    // Validação de CPFs com dígitos repetidos comuns
    if (["00000000000", "11111111111", "22222222222", "33333333333", 
         "44444444444", "55555555555", "66666666666", "77777777777", 
         "88888888888", "99999999999"].includes(cpf)) {
        return false;
    }
    
    let soma = 0;
    let resto;
    
    for (let i = 1; i <= 9; i++) {
        soma = soma + parseInt(cpf.substring(i-1, i)) * (11 - i);
    }
    
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto !== parseInt(cpf.substring(9, 10))) return false;
    
    soma = 0;
    for (let i = 1; i <= 10; i++) {
        soma = soma + parseInt(cpf.substring(i-1, i)) * (12 - i);
    }
    
    resto = (soma * 10) % 11;
    if ((resto === 10) || (resto === 11)) resto = 0;
    if (resto !== parseInt(cpf.substring(10, 11))) return false;
    
    return true;
}

// Renderiza o formulário de captação de WhatsApp para outras áreas na rota N1-R (não elegível para isenção)
function renderizarFormularioN1R() {
    // Limpa o painel de inputs do chatbot
    chatState.inputPanel.innerHTML = '';
    
    // Adiciona mensagem informativa sobre as outras áreas de atuação do escritório
    adicionarMensagem('bot', "Nosso escritório também atua nas áreas <strong>Trabalhista, Previdenciária, Tributária e Cível</strong>. Caso tenha dúvida sobre seus direitos em outras áreas, informe seu WhatsApp abaixo que entramos em contato.");

    // Cria contêiner para o formulário de inserção do WhatsApp
    const container = document.createElement('div');
    container.className = 'chat-form-container';
    
    // Define a estrutura HTML com campo de WhatsApp formatado e botão de ação
    container.innerHTML = `
        <div class="chat-input-wrapper">
            <input type="tel" class="chat-text-input" placeholder="(11) 99999-9999" id="n1r-phone" maxlength="15" required />
            <div class="chat-input-error-msg" id="n1r-phone-error">Por favor, digite seu WhatsApp completo com DDD.</div>
        </div>
        <div class="chat-btn-row">
            <button class="chat-skip-btn" id="n1r-share-btn" style="border-color:var(--cor-dourado); color:var(--cor-dourado);">Compartilhar Link</button>
            <button class="chat-submit-btn" id="n1r-submit-btn" disabled>Entrar em Contato</button>
        </div>
    `;
    
    chatState.inputPanel.appendChild(container);
    
    const phoneInput = document.getElementById('n1r-phone');
    const shareBtn = document.getElementById('n1r-share-btn');
    const submitBtn = document.getElementById('n1r-submit-btn');
    const errorEl = document.getElementById('n1r-phone-error');
    
    // Coloca foco automático no campo de digitação
    phoneInput.focus();
    
    // Adiciona máscara e validação de telefone (DDD + 9 dígitos) no campo de WhatsApp
    phoneInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, "");
        if (value.length > 11) value = value.slice(0, 11);
        
        // Aplica a formatação do telefone: (XX) XXXXX-XXXX
        if (value.length > 10) {
            value = `(${value.slice(0, 2)}) ${value.slice(2, 7)}-${value.slice(7)}`;
        } else if (value.length > 6) {
            value = `(${value.slice(0, 2)}) ${value.slice(2, 6)}-${value.slice(6)}`;
        } else if (value.length > 2) {
            value = `(${value.slice(0, 2)}) ${value.slice(2)}`;
        } else if (value.length > 0) {
            value = `(${value}`;
        }
        
        e.target.value = value;
        
        // Libera ou bloqueia o botão de envio baseado no tamanho do número digitado
        const digitosApenas = e.target.value.replace(/\D/g, "");
        const valido = digitosApenas.length === 11;
        submitBtn.disabled = !valido;
        
        // Exibe mensagem de erro caso o telefone seja incompleto
        if (digitosApenas.length > 2 && digitosApenas.length < 11) {
            errorEl.style.display = 'block';
        } else {
            errorEl.style.display = 'none';
        }
    });
    
    // Configura evento de compartilhamento do simulador
    shareBtn.addEventListener('click', () => {
        const link = obterLinkCompartilhamento();
        if (navigator.share) {
            navigator.share({
                title: 'Simulador de Isenção de IR - LBM Advogados',
                text: 'Veja em menos de 2 minutos se você tem direito a parar de pagar IR e receber restituição retroativa.',
                url: link
            }).catch(err => console.log('Erro de compartilhamento:', err));
        } else {
            // Copia o link para a área de transferência do usuário como fallback
            navigator.clipboard.writeText(link).then(() => {
                alert('Link de indicação copiado com sucesso!');
            });
        }
        enviarGTM('n1r_compartilhado');
    });
    
    // Configura evento de envio do número de WhatsApp e redirecionamento de atendimento
    submitBtn.addEventListener('click', () => {
        const digitosApenas = phoneInput.value.replace(/\D/g, "");
        if (digitosApenas.length === 11) {
            // Armazena e envia o lead de contato de outras áreas ao CRM
            dadosLead.whatsapp = `+55${digitosApenas}`;
            enviarLeadAoCRM("outras_areas_n1r");
            
            // Texto parametrizado para o WhatsApp do escritório indicando interesse em outras áreas
            const textoWhats = `Olá! Gostaria de falar com um advogado sobre outras áreas de atuação (Trabalhista, Previdenciária, Tributária ou Cível) do escritório LBM Advogados.`;
            const linkWhats = `https://api.whatsapp.com/send/?phone=${WHATSAPP_NUMERO}&text=${encodeURIComponent(textoWhats)}`;
            
            // Abre o WhatsApp em uma nova aba
            window.open(linkWhats, '_blank');
        }
        // Fecha a sobreposição do chatbot e revela a página
        fecharChatbotRevelarLP();
    });
}

// Renderiza o formulário de captação de WhatsApp para outras áreas na rota N6-A-R (baixo valor estimado de isenção)
function renderizarFormularioN6AR() {
    // Limpa o painel de inputs do chatbot
    chatState.inputPanel.innerHTML = '';
    
    // Adiciona mensagem informativa sobre as outras áreas de atuação do escritório
    adicionarMensagem('bot', "Nosso escritório também atua nas áreas <strong>Trabalhista, Previdenciária, Tributária e Cível</strong>. Caso tenha dúvida sobre seus direitos em outras áreas, informe seu WhatsApp abaixo que entramos em contato.");

    // Cria contêiner para o formulário de inserção do WhatsApp
    const container = document.createElement('div');
    container.className = 'chat-form-container';
    
    // Define a estrutura HTML com campo de WhatsApp formatado e botão de ação
    container.innerHTML = `
        <div class="chat-input-wrapper">
            <input type="tel" class="chat-text-input" placeholder="(11) 99999-9999" id="n6ar-phone" maxlength="15" required />
            <div class="chat-input-error-msg" id="n6ar-phone-error">Por favor, digite seu WhatsApp completo com DDD.</div>
        </div>
        <div class="chat-btn-row">
            <button class="chat-skip-btn" id="n6ar-share-btn" style="border-color:var(--cor-dourado); color:var(--cor-dourado);">Compartilhar Link</button>
            <button class="chat-submit-btn" id="n6ar-submit-btn" disabled>Entrar em Contato</button>
        </div>
    `;
    
    chatState.inputPanel.appendChild(container);
    
    const phoneInput = document.getElementById('n6ar-phone');
    const shareBtn = document.getElementById('n6ar-share-btn');
    const submitBtn = document.getElementById('n6ar-submit-btn');
    const errorEl = document.getElementById('n6ar-phone-error');
    
    // Coloca foco automático no campo de digitação
    phoneInput.focus();
    
    // Adiciona máscara e validação de telefone (DDD + 9 dígitos) no campo de WhatsApp
    phoneInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, "");
        if (value.length > 11) value = value.slice(0, 11);
        
        // Aplica a formatação do telefone: (XX) XXXXX-XXXX
        if (value.length > 10) {
            value = `(${value.slice(0, 2)}) ${value.slice(2, 7)}-${value.slice(7)}`;
        } else if (value.length > 6) {
            value = `(${value.slice(0, 2)}) ${value.slice(2, 6)}-${value.slice(6)}`;
        } else if (value.length > 2) {
            value = `(${value.slice(0, 2)}) ${value.slice(2)}`;
        } else if (value.length > 0) {
            value = `(${value}`;
        }
        
        e.target.value = value;
        
        // Libera ou bloqueia o botão de envio baseado no tamanho do número digitado
        const digitosApenas = e.target.value.replace(/\D/g, "");
        const valido = digitosApenas.length === 11;
        submitBtn.disabled = !valido;
        
        // Exibe mensagem de erro caso o telefone seja incompleto
        if (digitosApenas.length > 2 && digitosApenas.length < 11) {
            errorEl.style.display = 'block';
        } else {
            errorEl.style.display = 'none';
        }
    });
    
    // Configura evento de compartilhamento do simulador
    shareBtn.addEventListener('click', () => {
        const link = obterLinkCompartilhamento();
        if (navigator.share) {
            navigator.share({
                title: 'Simulador de Isenção de IR - LBM Advogados',
                text: 'Faça a sua simulação de isenção de imposto de renda por doença grave.',
                url: link
            });
        } else {
            // Copia o link para a área de transferência do usuário como fallback
            navigator.clipboard.writeText(link).then(() => {
                alert('Link de indicação copiado com sucesso!');
            });
        }
    });
    
    // Configura evento de envio do número de WhatsApp e redirecionamento de atendimento
    submitBtn.addEventListener('click', () => {
        const digitosApenas = phoneInput.value.replace(/\D/g, "");
        if (digitosApenas.length === 11) {
            // Armazena e envia o lead de contato de outras áreas ao CRM
            dadosLead.whatsapp = `+55${digitosApenas}`;
            dadosLead.lead_score = 'baixo_valor';
            enviarLeadAoCRM("outras_areas_n6ar");
            
            // Texto parametrizado para o WhatsApp do escritório indicando interesse em outras áreas e incluindo o nome do lead
            const textoWhats = `Olá! Sou o(a) ${dadosLead.nome || 'cliente'} e gostaria de falar com um advogado sobre outras áreas de atuação (Trabalhista, Previdenciária, Tributária ou Cível) do escritório LBM Advogados.`;
            const linkWhats = `https://api.whatsapp.com/send/?phone=${WHATSAPP_NUMERO}&text=${encodeURIComponent(textoWhats)}`;
            
            // Abre o WhatsApp em uma nova aba
            window.open(linkWhats, '_blank');
        }
        // Fecha a sobreposição do chatbot e revela a página
        fecharChatbotRevelarLP();
    });
}

// Retorna o link da página contendo os parâmetros de rastreamento para indicação
function obterLinkCompartilhamento() {
    const base = window.location.origin + window.location.pathname;
    const utmSource = obterUTM('utm_source') || 'indicação_cliente';
    const utmMedium = obterUTM('utm_medium') || 'chat_share';
    return `${base}?utm_source=${encodeURIComponent(utmSource)}&utm_medium=${encodeURIComponent(utmMedium)}&nocallback=1`;
}

// --- LOGICA DE LEAD SCORING ---

// Executa a classificação de temperatura do lead baseado nas respostas fornecidas
function calcularLeadScore() {
    const perfilValido = ['aposentado', 'pensionista', 'reformado_militar'].includes(dadosLead.perfil);
    const temLaudoSim = dadosLead.tem_laudo === 'sim';
    const intencaoDireito = dadosLead.intencao === 'quero_direito';
    const doencaLista = dadosLead.doenca_outra === false && dadosLead.doenca !== '';

    if (dadosLead.faixa_ate5k_detalhe === 'abaixo_3k' && dadosLead.desconta_ir !== 'true') {
        dadosLead.lead_score = 'baixo_valor';
    } else if (dadosLead.doenca_outra) {
        dadosLead.lead_score = 'frio';
    } else if (perfilValido && doencaLista && temLaudoSim && intencaoDireito) {
        dadosLead.lead_score = 'quente';
    } else if (perfilValido && doencaLista && (dadosLead.tem_laudo === 'nao_ainda' || dadosLead.intencao === 'quero_informacao')) {
        dadosLead.lead_score = 'morno';
    } else {
        dadosLead.lead_score = 'frio';
    }
}

// --- RENDERS DA ETAPA FINAL ---

// Exibe a tela final de encerramento do chat com os dados processados e botões finais
function renderizarTelaFinalDeSucesso() {
    chatState.inputPanel.innerHTML = '';
    
    const container = document.createElement('div');
    container.className = 'chat-final-container';
    
    // Configura ícones e mensagens baseados no lead score
    let titulo = "Análise Pronta!";
    let texto = `Tudo certo, <strong>${dadosLead.nome}</strong>! Nossa equipe jurídica analisará seus dados imediatamente e entraremos em contato.`;
    let icone = "📋";
    
    if (dadosLead.lead_score === 'quente') {
        icone = "🎉";
        titulo = "Ótima notícia!";
        texto = `Excelente, <strong>${dadosLead.nome}</strong>! Com o seu perfil e o diagnóstico selecionado, você tem <strong>fortes chances</strong> de conseguir a isenção de Imposto de Renda e a restituição dos últimos 5 anos.`;
    } else if (dadosLead.lead_score === 'baixo_valor') {
        icone = "⚖️";
        titulo = "Análise registrada!";
        texto = `Olá <strong>${dadosLead.nome}</strong>. Como a sua faixa de renda está abaixo de R$ 3.000, o benefício financeiro de isenção de IR pode ser baixo, mas nosso time está disponível caso queira tirar dúvidas.`;
    }
    
    // Constrói o HTML da tela
    let html = `
        <div class="chat-final-icon">${icone}</div>
        <h3 class="chat-final-title">${titulo}</h3>
        <p class="chat-final-text">${texto}</p>
    `;
    
    // Se não for um lead não elegível, exibe a estimativa financeira na tela
    if (dadosLead.lead_score !== 'frio' && dadosLead.faixa_renda !== '') {
        const resumoFinanceiro = calcularEstimativaFinanceira();
        html += `
            <div class="chat-summary-box">
                <div class="chat-summary-title">Resumo Estimativo da Simulação</div>
                <div class="chat-summary-row">
                    <span>IR Mensal Pago:</span>
                    <strong>R$ ${resumoFinanceiro.irMensal.toFixed(2).replace('.', ',')}</strong>
                </div>
                <div class="chat-summary-row">
                    <span>Restituição Retroativa (5 anos):</span>
                    <strong>R$ ${resumoFinanceiro.retroativo.toFixed(2).replace('.', ',')}</strong>
                </div>
                <div class="chat-summary-row highlight">
                    <span>Economia Total Estimada:</span>
                    <strong>R$ ${resumoFinanceiro.total.toFixed(2).replace('.', ',')}</strong>
                </div>
            </div>
        `;
    }
    
    // Adiciona os botões finais de Handoff (WhatsApp e LP)
    const linkWhatsApp = obterLinkHandoffWhatsApp();
    html += `
        <div class="chat-final-actions">
            <a href="${linkWhatsApp}" target="_blank" rel="noopener noreferrer" class="chat-final-btn-whatsapp" id="chat-final-whats-link">
                <svg viewBox="0 0 448 512" xmlns="http://www.w3.org/2000/svg">
                    <path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"></path>
                </svg>
                Falar agora no WhatsApp
            </a>
            <button class="chat-final-btn-lp" id="chat-final-goto-lp">Acessar Site Completo</button>
        </div>
        <div class="chat-final-footer">
            Este contato é 100% gratuito e confidencial. LBM Advogados — OAB/SP 53.225.
        </div>
    `;
    
    container.innerHTML = html;
    chatState.inputPanel.appendChild(container);
    
    // Adiciona o ouvinte para fechar o chat e revelar a Landing Page
    document.getElementById('chat-final-goto-lp').addEventListener('click', fecharChatbotRevelarLP);
    
    // Adiciona evento de clique de conversão final para o GTM
    document.getElementById('chat-final-whats-link').addEventListener('click', () => {
        enviarGTM('lead_whats_handoff', {
            nome: dadosLead.nome,
            lead_score: dadosLead.lead_score,
            whatsapp: dadosLead.whatsapp
        });
    });
}

// Oculta a sobreposição do chat e revela a landing page com animação de fade-out
function fecharChatbotRevelarLP() {
    const overlay = document.getElementById('lbm-chat-overlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.classList.remove('active');
            document.body.style.overflow = ''; // Devolve controle de rolagem ao body
            
            // Grava na sessão para que o chat não reabra sozinho na mesma navegação
            sessionStorage.setItem('lbm_chat_respondido', 'true');
        }, 400);
    }
}

// Abre o chatbot manualmente (invocado a partir dos CTAs da landing page)
window.abrirChatbot = function(reiniciar = true) {
    if (reiniciar) {
        inicializarChatbot();
    } else {
        const overlay = document.getElementById('lbm-chat-overlay');
        if (overlay) {
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    }
};

// --- LOGICA DE CÁLCULO ESTIMADO FINANCEIRO ---

// Helper para cálculo financeiro simplificado e exibição no resumo final
function calcularEstimativaFinanceira() {
    let rendaMedia = 4000;
    
    // Mapeamento de valor médio baseado na faixa escolhida
    if (dadosLead.faixa_renda === 'ate_5k') {
        rendaMedia = dadosLead.faixa_ate5k_detalhe === 'entre_3k_5k' ? 4000 : 2500;
    } else if (dadosLead.faixa_renda === '5k_7350') {
        rendaMedia = 6100;
    } else if (dadosLead.faixa_renda === '7350_10k') {
        rendaMedia = 8700;
    } else if (dadosLead.faixa_renda === 'acima_10k') {
        rendaMedia = 13500;
    }
    
    // Cálculo progressivo do IRPF
    let irMensal = 0;
    if (rendaMedia > 4664.68) {
        irMensal = (rendaMedia * 0.275) - 896.00;
    } else if (rendaMedia > 3751.05) {
        irMensal = (rendaMedia * 0.225) - 662.77;
    } else if (rendaMedia > 2826.65) {
        irMensal = (rendaMedia * 0.15) - 381.44;
    } else if (rendaMedia > 2259.20) {
        irMensal = (rendaMedia * 0.075) - 169.44;
    }
    
    // Se desconta_ir for explicitamente falso, zera estimativa de desconto mensal futuro
    if (dadosLead.desconta_ir === 'false') {
        irMensal = 0;
    }
    
    // Restituição dos últimos 5 anos (60 parcelas mensais de IR)
    const retroativo = irMensal * 12 * 5;
    
    // Projeta 10 anos de economia futura
    const economiaFutura = irMensal * 12 * 10;
    
    return {
        irMensal: irMensal,
        retroativo: retroativo,
        total: retroativo + economiaFutura
    };
}

// --- CONSTRUTOR DA URL DO WHATSAPP ---

// Monta o link final da API do WhatsApp com os dados e variáveis de qualificação
function obterLinkHandoffWhatsApp() {
    const utmSource = obterUTM('utm_source');
    const utmMedium = obterUTM('utm_medium');
    const gclid = obterUTM('gclid');
    const gbraid = obterUTM('gbraid');
    
    // Texto pré-preenchido parametrizado
    let texto = `Olá, me chamo ${dadosLead.nome} e quero saber se tenho direito à isenção de IR por doença grave.\n\n`;
    texto += `📋 DADOS ENVIADOS:\n`;
    texto += `• Perfil: ${dadosLead.perfil}\n`;
    texto += `• Diagnóstico: ${dadosLead.doenca}\n`;
    texto += `• Tem Laudo: ${dadosLead.tem_laudo}\n`;
    texto += `• Renda: ${dadosLead.faixa_renda}\n`;
    texto += `• Regime: ${dadosLead.regime}\n`;
    texto += `• E-mail: ${dadosLead.email}\n`;
    
    if (dadosLead.cpf) {
        texto += `• CPF: ${dadosLead.cpf} (Validade: ${dadosLead.cpf_valido ? 'Sim' : 'Não/Ignorado'})\n`;
    }
    
    if (dadosLead.lead_score) {
        texto += `• Temperatura: ${dadosLead.lead_score.toUpperCase()}\n`;
    }
    
    // URL amigável final
    let link = `https://api.whatsapp.com/send/?phone=${WHATSAPP_NUMERO}&text=${encodeURIComponent(texto)}`;
    
    // Propaga as UTMs coletadas para rastreamento de clique final
    if (utmSource) link += `&utm_source=${encodeURIComponent(utmSource)}`;
    if (utmMedium) link += `&utm_medium=${encodeURIComponent(utmMedium)}`;
    if (gclid) link += `&gclid=${encodeURIComponent(gclid)}`;
    if (gbraid) link += `&gbraid=${encodeURIComponent(gbraid)}`;
    
    return link;
}

// --- EXECUTOR AUTOMÁTICO DE CARREGAMENTO ---

document.addEventListener('DOMContentLoaded', () => {
    // Captura e armazena os UTMs da URL imediatamente ao entrar na página
    capturarPersistirUTMs();
    
    // Verifica se já respondeu ao chatbot nesta sessão. 
    // Se já respondeu, não abre de forma automática para evitar frustração do usuário ao navegar.
    const jaRespondido = sessionStorage.getItem('lbm_chat_respondido');
    const skipParam = new URLSearchParams(window.location.search).get('skipchat') || new URLSearchParams(window.location.search).get('nocallback');
    
    if (!jaRespondido && skipParam !== '1' && skipParam !== 'true') {
        // Dispara o chatbot obrigatoriamente
        inicializarChatbot();
    }
});
