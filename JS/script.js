/* ==========================================================================
   SCRIPT PRINCIPAL — Lotufo Advocacia (Isenção de Imposto de Renda)
   Funcionalidades:
     1. Simulador de Restituição de IRPF (Cálculo Retroativo + Economia Futura)
     2. Geração de Mensagem Personalizada do WhatsApp com Resultados da Simulação
     3. FAQ Accordion com transição suave e controle de estados
     4. Controle de rolagem do Header (Efeito Glassmorphism Dinâmico)
     5. Navegação responsiva móvel (Menu Hambúrguer)
     6. Animações de entrada escalonadas via Intersection Observer
     7. Automação do Balão do WhatsApp Flutuante com atraso (delay) inicial
   ========================================================================== */

// --- DADOS E PARÂMETROS DO ESCRITÓRIO ---
// Configuração centralizada do escritório com o novo número de telefone fornecido pelo usuário
const ESCRITORIO = {
    nome: 'Lotufo Advocacia',
    telefone: '5511943099915', // Telefone internacional atualizado (5511943099915)
    msgPadrao: 'Olá! Gostaria de falar com um advogado sobre Isenção de Imposto de Renda para Aposentado com Doença Grave. Pode me ajudar?',
};

// --- TABELA PROGRESSIVA MENSAL DO IMPOSTO DE RENDA (2024 / 2025) ---
// Alíquotas e deduções oficiais por faixa de rendimento
const TABELA_IRPF = [
    { limite: 2259.20,   aliquota: 0,     deducao: 0      },
    { limite: 2826.65,   aliquota: 0.075, deducao: 169.44 },
    { limite: 3751.05,   aliquota: 0.15,  deducao: 381.44 },
    { limite: 4664.68,   aliquota: 0.225, deducao: 662.77 },
    { limite: Infinity,  aliquota: 0.275, deducao: 896.00 },
];

// ==========================================================================
// FUNÇÕES UTILITÁRIAS
// ==========================================================================

/**
 * Envia um evento personalizado para a camada de dados (dataLayer) do Google Tag Manager
 * @param {string} nomeEvento - Nome do evento que será capturado pelas tags e acionadores do GTM
 * @param {object} [parametros={}] - Dados adicionais coletados para envio com o evento de conversão
 */
function dispararEventoGTM(nomeEvento, parametros = {}) {
    // Garante que o array do dataLayer exista no escopo global
    window.dataLayer = window.dataLayer || [];
    // Adiciona o evento formatado à camada de dados
    window.dataLayer.push({
        event: nomeEvento,
        ...parametros
    });
}

/**
 * Formata um valor numérico decimal para o formato monetário padrão brasileiro (R$ X.XXX,XX)
 * @param {number} valor - O valor float a ser formatado
 * @returns {string} - String formatada em Real (BRL)
 */
function formatarMoeda(valor) {
    return 'R$\u00a0' + valor.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

/**
 * Calcula o Imposto de Renda mensal devido com base na tabela progressiva
 * @param {number} rendimentoBruto - Rendimento bruto mensal da aposentadoria/pensão
 * @returns {number} - Valor aproximado do IR retido mensalmente
 */
function calcularIRMensal(rendimentoBruto) {
    // Percorre cada faixa da tabela progressiva de IR até encontrar o enquadramento
    for (const faixa of TABELA_IRPF) {
        if (rendimentoBruto <= faixa.limite) {
            return Math.max(0, rendimentoBruto * faixa.aliquota - faixa.deducao);
        }
    }
    return 0;
}

// ==========================================================================
// SIMULADOR DE RESTITUIÇÃO DE IRPF
// ==========================================================================

/**
 * Executa o cálculo da simulação com base nos dados fornecidos pelo usuário no formulário
 */
function executarSimulacao() {
    // Captura os elementos de entrada e alerta no DOM
    const doencaSelect      = document.getElementById('cid-select');
    const regimeSelect      = document.getElementById('regime-aposentadoria');
    const valorBrutoInput   = document.getElementById('valor-bruto');
    const anosPagandoSelect = document.getElementById('anos-pagando');
    const anoDiagnosticoInput = document.getElementById('ano-diagnostico');
    const idadeAtualInput   = document.getElementById('idade-atual');
    const alertaEl          = document.getElementById('calc-alerta');
    const resultadoBox      = document.getElementById('resultado');

    // Sanitiza e extrai os valores
    const doencaValor   = doencaSelect ? doencaSelect.value : '';
    const regimeValor   = regimeSelect ? regimeSelect.value : 'INSS (Regime Geral)';
    const valorBruto    = parseFloat(valorBrutoInput ? valorBrutoInput.value : 0);
    const anosPagando   = parseInt(anosPagandoSelect ? anosPagandoSelect.value : 5);
    const anoDiagnostico = parseInt(anoDiagnosticoInput ? anoDiagnosticoInput.value : 0);
    const idadeAtual    = parseInt(idadeAtualInput ? idadeAtualInput.value : 0);

    // Oculta alertas anteriores
    if (alertaEl) alertaEl.style.display = 'none';

    // Validações do formulário
    if (!doencaValor) {
        exibirMensagemAlerta('Por favor, selecione qual a doença diagnosticada.');
        return;
    }
    if (!valorBruto || valorBruto <= 0) {
        exibirMensagemAlerta('Por favor, informe o valor bruto mensal recebido de aposentadoria ou pensão.');
        return;
    }
    if (!anoDiagnostico || anoDiagnostico < 1970 || anoDiagnostico > new Date().getFullYear()) {
        exibirMensagemAlerta(`Por favor, informe um ano de diagnóstico válido entre 1970 e ${new Date().getFullYear()}.`);
        return;
    }
    if (!idadeAtual || idadeAtual <= 0 || idadeAtual > 120) {
        exibirMensagemAlerta('Por favor, informe uma idade atual válida entre 1 e 120 anos.');
        return;
    }

    // Se o valor de aposentadoria for inferior ao limite mínimo de tributação da primeira faixa do IR
    if (valorBruto < 2259.21) {
        exibirMensagemAlerta('Aposentadorias abaixo de R$ 2.259,20 já são naturalmente isentas do Imposto de Renda. Fale com nossos advogados se houver outros descontos em folha.');
        return;
    }

    // --- CÁLCULO FINANCEIRO ---
    // 1. Calcula o IR mensal retido na fonte
    const irMensal = calcularIRMensal(valorBruto);
    // 2. Projeta o IR anual (12 parcelas, excluindo 13º para manter estimativa conservadora)
    const irAnual = irMensal * 12;

    // --- CÁLCULO DE RESTITUIÇÃO RETROATIVA (ÚLTIMOS 5 ANOS) ---
    const anoAtual = new Date().getFullYear();
    const anosDesdeDiagnostico = Math.max(0, anoAtual - anoDiagnostico);
    // O retroativo é limitado ao menor valor entre: anos declarados, tempo desde diagnóstico e o limite legal de 5 anos
    const anosRestituicao = Math.min(anosPagando, anosDesdeDiagnostico, 5);
    const totalRetroativo = irAnual * anosRestituicao;

    // --- CÁLCULO DE ECONOMIA FUTURA (ATÉ 76 ANOS - EXPECTATIVA IBGE) ---
    // Projeta os anos de isenção que o cliente usufruirá baseado na expectativa média de vida
    const anosProjetadosEconomia = Math.max(0, 76 - idadeAtual);
    const totalEconomiaFutura = irAnual * anosProjetadosEconomia;

    // --- TOTAL GERAL ---
    const beneficioTotal = totalRetroativo + totalEconomiaFutura;

    // --- EXIBIÇÃO E ATUALIZAÇÃO DO RESULTADO NO DOM ---
    document.getElementById('res-bruto').textContent            = formatarMoeda(valorBruto);
    document.getElementById('res-ir-mensal').textContent        = formatarMoeda(irMensal);
    document.getElementById('res-ir-anual').textContent         = formatarMoeda(irAnual);
    document.getElementById('res-anos').textContent             = anosRestituicao + (anosRestituicao === 1 ? ' ano' : ' anos');
    document.getElementById('res-retroativo-total').textContent = formatarMoeda(totalRetroativo);
    document.getElementById('res-anos-futuros').textContent     = anosProjetadosEconomia + (anosProjetadosEconomia === 1 ? ' ano' : ' anos');
    document.getElementById('res-economia-futura').textContent  = formatarMoeda(totalEconomiaFutura);
    document.getElementById('res-total').textContent            = formatarMoeda(beneficioTotal);
    document.getElementById('res-regime-txt').textContent       = regimeValor;

    // Torna a div de resultados visível
    if (resultadoBox) {
        resultadoBox.classList.add('visivel');
        // Rola a página suavemente até o resultado obtido
        setTimeout(() => {
            resultadoBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 150);
    }

    // Obtém o nome da doença selecionada para o evento e para a mensagem do WhatsApp (Movido para antes para evitar ReferenceError)
    const nomeDoenca = doencaSelect ? doencaSelect.options[doencaSelect.selectedIndex].text : '';

    // Dispara evento de simulação concluída com sucesso para o GTM com parâmetros enriquecidos
    dispararEventoGTM('simulacao_realizada', {
        doenca: nomeDoenca,
        regime: regimeValor,
        valor_bruto: valorBruto,
        restituicao_retroativa: totalRetroativo,
        economia_futura: totalEconomiaFutura,
        beneficio_total: beneficioTotal
    });

    // --- GERAÇÃO DA URL DO WHATSAPP COM A MENSAGEM DINÂMICA ---
    const textoMensagem = 
        `Olá! Realizei a simulação de isenção de IR no site da Lotufo Advocacia e gostaria de analisar meu caso.\n\n` +
        `📋 DADOS SIMULADOS:\n` +
        `• Doença grave: ${nomeDoenca}\n` +
        `• Regime previdenciário: ${regimeValor}\n` +
        `• Valor bruto mensal: ${formatarMoeda(valorBruto)}\n` +
        `• Ano de diagnóstico: ${anoDiagnostico}\n` +
        `• Idade atual: ${idadeAtual} anos\n` +
        `• Tempo pagando IR: ${anosPagando} anos\n\n` +
        `💰 ESTIMATIVA DA SIMULAÇÃO:\n` +
        `• IR mensal retido: ${formatarMoeda(irMensal)}\n` +
        `• Restituição retroativa (${anosRestituicao} anos): ${formatarMoeda(totalRetroativo)}\n` +
        `• Economia futura estimada (${anosProjetadosEconomia} anos): ${formatarMoeda(totalEconomiaFutura)}\n` +
        `• BENEFÍCIO TOTAL ESTIMADO: ${formatarMoeda(beneficioTotal)}\n\n` +
        `Desejo agendar uma consulta gratuita para verificar se tenho direito legal ao benefício.`;

    const linkWhats = `https://api.whatsapp.com/send/?phone=${ESCRITORIO.telefone}&text=${encodeURIComponent(textoMensagem)}`;
    const btnWaResultado = document.getElementById('btn-wa-resultado');
    if (btnWaResultado) {
        btnWaResultado.href = linkWhats;
    }
}

/**
 * Exibe um alerta personalizado na calculadora (evitando alerts padrão do navegador)
 * @param {string} msg - Mensagem de texto a ser exibida no alerta
 */
function exibirMensagemAlerta(msg) {
    const alertaEl = document.getElementById('calc-alerta');
    if (!alertaEl) return;
    alertaEl.textContent = msg;
    alertaEl.style.display = 'block';
    
    // Rola até o topo da calculadora para que o usuário veja a validação
    const calcEl = document.getElementById('simulador');
    if (calcEl) calcEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ==========================================================================
// COMPORTAMENTO DO FAQ (ACORDEÃO)
// ==========================================================================

/**
 * Controla o abrir/fechar dos painéis de perguntas frequentes de forma exclusiva (apenas um aberto por vez)
 * @param {HTMLElement} btn - Botão clicado
 */
function toggleFAQItem(btn) {
    const item = btn.closest('.faq-item');
    const resposta = item.querySelector('.faq-resposta');
    const estaAberto = item.classList.contains('aberto');

    // Fecha todos os itens abertos anteriormente
    document.querySelectorAll('.faq-item.aberto').forEach((el) => {
        el.classList.remove('aberto');
        const resp = el.querySelector('.faq-resposta');
        if (resp) resp.style.maxHeight = null;
    });

    // Se o item clicado estava fechado, abre-o animando a propriedade max-height
    if (!estaAberto) {
        item.classList.add('aberto');
        if (resposta) {
            resposta.style.maxHeight = resposta.scrollHeight + 'px';
        }
    }
}

// ==========================================================================
// CONTROLE DE NAVEGAÇÃO E SCROLL
// ==========================================================================

/**
 * Gerencia a adição de classe no Header ao rolar a página para efeito escuro e redução de altura
 */
function controlarScrollHeader() {
    const header = document.getElementById('header-principal');
    if (!header) return;

    if (window.scrollY > 50) {
        header.classList.add('scrolled');
    } else {
        header.classList.remove('scrolled');
    }
}

/**
 * Gerencia o menu hambúrguer para dispositivos móveis
 */
function controlarMenuMobile() {
    const navMenu = document.getElementById('nav-menu');
    const toggleBtn = document.getElementById('mobile-toggle');
    const estaAberto = navMenu.classList.contains('active');

    if (navMenu) navMenu.classList.toggle('active');
    if (toggleBtn) {
        toggleBtn.classList.toggle('active');
        toggleBtn.setAttribute('aria-expanded', !estaAberto);
    }

    // Impede o scroll de fundo do body quando o menu mobile estiver aberto
    document.body.style.overflow = estaAberto ? '' : 'hidden';
}

/**
 * Fecha o menu móvel ao clicar em links ou no botão X
 */
function fecharMenuMobile() {
    const navMenu = document.getElementById('nav-menu');
    const toggleBtn = document.getElementById('mobile-toggle');
    
    if (navMenu) navMenu.classList.remove('active');
    if (toggleBtn) {
        toggleBtn.classList.remove('active');
        toggleBtn.setAttribute('aria-expanded', 'false');
    }
    document.body.style.overflow = '';
}

// ==========================================================================
// ANIMAÇÕES DE SCROLL (INTERSECTION OBSERVER)
// ==========================================================================

/**
 * Observa os elementos marcados no HTML e aplica animação de revelação progressiva
 */
function inicializarAnimacoesDeScroll() {
    const itensParaAnimar = document.querySelectorAll(
        '.doenca-card, .diferencial-card, .secao-header, .sobre-content, .sobre-imagem-wrapper, .calc-wrapper, .faq-item, .contato-split-grid'
    );

    // Configura os estilos de partida dos elementos (invisíveis e levemente deslocados para baixo)
    itensParaAnimar.forEach((item) => {
        item.style.opacity = '0';
        item.style.transform = 'translateY(25px)';
        item.style.transition = 'opacity 0.7s cubic-bezier(0.165, 0.84, 0.44, 1), transform 0.7s cubic-bezier(0.165, 0.84, 0.44, 1)';
    });

    // Cria o observer de interseção
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                observer.unobserve(entry.target); // Para de observar após a primeira exibição
            }
        });
    }, {
        threshold: 0.08, // Inicia a animação quando pelo menos 8% do elemento estiver na tela
        rootMargin: '0px 0px -40px 0px'
    });

    // Observa cada item aplicando um atraso escalonado (delay de transição) para efeito cascata
    itensParaAnimar.forEach((item, index) => {
        item.style.transitionDelay = (index % 4 * 0.08) + 's';
        observer.observe(item);
    });
}

// ==========================================================================
// AUTOMATIZAÇÃO DO WHATSAPP FLUTUANTE
// ==========================================================================

/**
 * Exibe automaticamente o mini-balão do WhatsApp flutuante após um período de tempo
 */
function programarBalaoWhatsApp() {
    const balao = document.getElementById('wa-balao');
    if (!balao) return;

    // Dispara a exibição automática do balão após 4 segundos
    setTimeout(() => {
        // Apenas exibe se o usuário não tiver fechado ou aberto manualmente
        if (!balao.classList.contains('active')) {
            balao.classList.add('active');
        }
    }, 4000);

    // Remove a classe de exibição automática se o usuário passar o mouse sobre o botão
    const wrapper = document.getElementById('wa-wrapper');
    if (wrapper) {
        wrapper.addEventListener('mouseenter', () => {
            balao.classList.remove('active');
        });
    }
}

// ==========================================================================
// INICIALIZAÇÃO EVENT LISTENERS
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    // 1. Ouvinte de scroll para o header fixo
    window.addEventListener('scroll', controlarScrollHeader, { passive: true });
    controlarScrollHeader(); // Executa verificação de estado inicial ao carregar

    // 2. Configura as animações de surgimento no scroll
    inicializarAnimacoesDeScroll();

    // 3. Ouvintes de eventos do menu responsivo
    const toggleBtn = document.getElementById('mobile-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', controlarMenuMobile);
    }

    // Fecha o menu móvel ao clicar nos links de navegação
    document.querySelectorAll('.nav-link').forEach((link) => {
        link.addEventListener('click', fecharMenuMobile);
    });

    // 4. Ouvintes de eventos para as sanfonas do FAQ
    document.querySelectorAll('.faq-pergunta').forEach((perguntaBtn) => {
        perguntaBtn.addEventListener('click', function() {
            toggleFAQItem(this);
        });
    });

    // 5. Ouvinte de evento do botão calcular do simulador
    const btnCalcular = document.getElementById('btn-calcular');
    if (btnCalcular) {
        btnCalcular.addEventListener('click', executarSimulacao);
    }

    // Permite que o usuário aperte Enter dentro do input de renda para calcular
    const valorBrutoInput = document.getElementById('valor-bruto');
    if (valorBrutoInput) {
        valorBrutoInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                executarSimulacao();
            }
        });
    }

    // 6. Configura o gatilho de tempo do WhatsApp flutuante
    programarBalaoWhatsApp();

    // 7. Intercepta links âncora internos para rolagem suave compensando a altura do header
    document.querySelectorAll('a[href^="#"]').forEach((link) => {
        link.addEventListener('click', function(e) {
            const hash = this.getAttribute('href');
            if (hash === '#') return;
            
            const alvo = document.querySelector(hash);
            if (!alvo) return;

            e.preventDefault();

            const header = document.getElementById('header-principal');
            const alturaHeader = header ? header.offsetHeight : 80;
            const scrollPos = alvo.getBoundingClientRect().top + window.scrollY - alturaHeader - 15;

            window.scrollTo({
                top: scrollPos,
                behavior: 'smooth'
            });

            // Garante fechamento do menu no celular após a seleção
            fecharMenuMobile();
        });
    });

    // 8. Rastreamento automático de conversões ao clicar em links direcionando ao WhatsApp
    document.querySelectorAll('a[href*="whatsapp.com"], a[href*="wa.me"]').forEach((link) => {
        link.addEventListener('click', () => {
            const textoBotao = link.textContent.trim() || 'Botão Flutuante/Ícone';
            
            // Caso seja o botão específico de envio do relatório simulado
            if (link.id === 'btn-wa-resultado') {
                const doencaSelect = document.getElementById('cid-select');
                const nomeDoenca = doencaSelect ? doencaSelect.options[doencaSelect.selectedIndex].text : '';
                const totalRetroativoTxt = document.getElementById('res-retroativo-total')?.textContent || '';
                
                // Dispara evento indicando o lead que enviou a simulação
                dispararEventoGTM('lead_whatsapp_simulador', {
                    texto_botao: textoBotao,
                    doenca_selecionada: nomeDoenca,
                    restituicao_retroativa: totalRetroativoTxt
                });
            } else {
                // Para cliques nos botões gerais de contato direto
                dispararEventoGTM('clique_whatsapp', {
                    texto_botao: textoBotao,
                    origem_secao: link.closest('section')?.id || 'fora_de_secao'
                });
            }
        });
    });
});
