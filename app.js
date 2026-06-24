// State Management
let state = {
    expenses: [],
    activeWeekMonday: null, // Date object representing the Monday of the selected week
    theme: 'dark'
};

// Constant configuration
const BASE_WEEKLY_LIMIT = 941.50;
const BASE_THRESHOLD_SANO = 500.00;
const BASE_THRESHOLD_TOLERABLE = 700.00;
const WEEKLY_TIPS_BUFFER = 1000.00;
const QUINCENA_BUDGET_FREE = 1883.00;

// Category icons map
const categoryIcons = {
    comida: '🍔',
    transporte: '🚗',
    diversion: '🎬',
    compras: '🛍️',
    servicios: '💡',
    otros: '📦'
};

// Category names map
const categoryNames = {
    comida: 'Comida Extra',
    transporte: 'Transporte Extra',
    diversion: 'Diversión / Salidas',
    compras: 'Compras / Ropa',
    servicios: 'Servicios / Suscripciones',
    otros: 'Otros'
};

// Date utilities
function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    // Adjust when day is Sunday (getDay() returns 0)
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
}

function getWeekRange(mondayDate) {
    const start = new Date(mondayDate);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(mondayDate);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    
    return { start, end };
}

function getQuincenaRange(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();
    
    let start, end, label;
    const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    
    if (day <= 15) {
        start = new Date(year, month, 1, 0, 0, 0, 0);
        end = new Date(year, month, 15, 23, 59, 59, 999);
        label = `1a Quincena de ${monthNames[month]}`;
    } else {
        start = new Date(year, month, 16, 0, 0, 0, 0);
        end = new Date(year, month + 1, 0, 23, 59, 59, 999);
        label = `2a Quincena de ${monthNames[month]}`;
    }
    return { start, end, label };
}

function parseLocalDate(dateStr) {
    // Avoids timezone shift when parsing YYYY-MM-DD
    const parts = dateStr.split('-');
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatDateString(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function formatWeekDisplay(monday) {
    const range = getWeekRange(monday);
    const optStart = { day: 'numeric', month: 'short' };
    const optEnd = { day: 'numeric', month: 'short', year: 'numeric' };
    const startStr = range.start.toLocaleDateString('es-MX', optStart);
    const endStr = range.end.toLocaleDateString('es-MX', optEnd);
    return `${startStr} - ${endStr}`;
}

function formatCurrency(amount) {
    return amount.toLocaleString('es-MX', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// LocalStorage persistence
function saveToLocalStorage() {
    localStorage.setItem('gastos_personales_db', JSON.stringify(state.expenses));
}

function loadFromLocalStorage() {
    const db = localStorage.getItem('gastos_personales_db');
    if (db) {
        try {
            state.expenses = JSON.parse(db);
        } catch (e) {
            console.error("Error cargando base de datos", e);
            state.expenses = [];
        }
    } else {
        state.expenses = [];
    }
}

// Auto-clean database: keep current week + 4 previous weeks
function pruneOldExpenses() {
    if (state.expenses.length === 0) return;

    const currentMonday = getMonday(new Date());
    const cutoffMonday = new Date(currentMonday);
    cutoffMonday.setDate(cutoffMonday.getDate() - (4 * 7)); // Go back exactly 4 weeks (28 days)

    const initialCount = state.expenses.length;
    state.expenses = state.expenses.filter(exp => {
        const expDate = parseLocalDate(exp.date);
        return expDate >= cutoffMonday;
    });

    if (state.expenses.length !== initialCount) {
        saveToLocalStorage();
        console.log(`[Autolimpieza] Se eliminaron ${initialCount - state.expenses.length} gastos antiguos de hace más de 5 semanas.`);
    }
}

// Get list of all Monday date strings from the earliest expense (or current week) to the active week
function getAllWeeksMondays() {
    let earliestDate = new Date();
    state.expenses.forEach(exp => {
        const d = parseLocalDate(exp.date);
        if (d < earliestDate) {
            earliestDate = d;
        }
    });

    const startMonday = getMonday(earliestDate);
    const targetEndDate = new Date(Math.max(new Date().getTime(), state.activeWeekMonday.getTime()));
    const endMonday = getMonday(targetEndDate);

    let mondays = [];
    let currentMonday = new Date(startMonday);
    while (currentMonday <= endMonday) {
        mondays.push(formatDateString(currentMonday));
        currentMonday.setDate(currentMonday.getDate() + 7);
    }
    return mondays;
}

// Chronological Penalty Calculator
// Resolves carryovers week-by-week starting from the earliest expense to the active/current week
function calculateAllPenalties() {
    const mondays = getAllWeeksMondays();
    let penalties = {}; // Key: Monday date string (YYYY-MM-DD) -> Penalty carried over INTO this week
    let currentPenalty = 0; // Starts with zero penalty for the first week

    mondays.forEach(mondayStr => {
        penalties[mondayStr] = currentPenalty;

        // Calculate this week's spent
        const range = getWeekRange(parseLocalDate(mondayStr));
        const weekExpenses = state.expenses.filter(exp => {
            const d = parseLocalDate(exp.date);
            return d >= range.start && d <= range.end;
        });
        const spent = weekExpenses.reduce((sum, exp) => sum + exp.amount, 0);

        // This week's total allowance before carrying over next penalty is:
        // Free money limit (BASE_WEEKLY_LIMIT - currentPenalty) + tips buffer (WEEKLY_TIPS_BUFFER)
        const limitMax = Math.max(0, BASE_WEEKLY_LIMIT - currentPenalty);
        const limitAllowance = limitMax + WEEKLY_TIPS_BUFFER;

        // Next week's penalty is whatever spent exceeds limitAllowance
        const excess = spent - limitAllowance;
        currentPenalty = Math.max(0, excess);
    });

    return penalties;
}

// UI State Rendering
function updateUI() {
    // 1. Calculate penalties chronologically
    const penalties = calculateAllPenalties();
    
    // 2. Identify active week's previous penalty
    const activeWeekMondayStr = formatDateString(state.activeWeekMonday);
    const prevPenalty = penalties[activeWeekMondayStr] || 0;

    // 3. Compute active week's adjusted budget limits
    const limitSano = Math.max(0, BASE_THRESHOLD_SANO - prevPenalty);
    const limitTolerable = Math.max(0, BASE_THRESHOLD_TOLERABLE - prevPenalty);
    const limitMax = Math.max(0, BASE_WEEKLY_LIMIT - prevPenalty);
    const limitAllowance = limitMax + WEEKLY_TIPS_BUFFER; // Full scale of the progress bar

    // 4. Filter active week expenses and sum spent
    const weekRange = getWeekRange(state.activeWeekMonday);
    const weekExpenses = state.expenses.filter(exp => {
        const expDate = parseLocalDate(exp.date);
        return expDate >= weekRange.start && expDate <= weekRange.end;
    });
    const totalWeeklySpent = weekExpenses.reduce((sum, exp) => sum + exp.amount, 0);

    // 5. Calculate quincena expenses for savings card
    // Use the middle of the active week to determine the quincena it belongs to
    const midWeekDate = new Date(state.activeWeekMonday);
    midWeekDate.setDate(midWeekDate.getDate() + 3);
    const quincenaRange = getQuincenaRange(midWeekDate);
    
    const quincenaExpenses = state.expenses.filter(exp => {
        const expDate = parseLocalDate(exp.date);
        return expDate >= quincenaRange.start && expDate <= quincenaRange.end;
    });
    const totalQuincenaSpent = quincenaExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    const estimatedQuincenaSavings = Math.max(0, QUINCENA_BUDGET_FREE - totalQuincenaSpent);

    // 6. Calculate total accumulated tips savings across all weeks
    let totalTipsSaved = 0;
    const mondays = getAllWeeksMondays();
    mondays.forEach(mStr => {
        const p = penalties[mStr] || 0;
        const lMax = Math.max(0, BASE_WEEKLY_LIMIT - p);
        
        // Get week spent
        const r = getWeekRange(parseLocalDate(mStr));
        const wExp = state.expenses.filter(exp => {
            const d = parseLocalDate(exp.date);
            return d >= r.start && d <= r.end;
        });
        const s = wExp.reduce((sum, exp) => sum + exp.amount, 0);
        
        // Tips saved = $1000 - amount used to cover overspend
        const tipsSaved = Math.max(0, WEEKLY_TIPS_BUFFER - Math.max(0, s - lMax));
        totalTipsSaved += tipsSaved;
    });

    // 7. Update Text elements
    document.getElementById('current-week-label').innerText = formatWeekDisplay(state.activeWeekMonday);
    document.getElementById('txt-weekly-spent').innerText = formatCurrency(totalWeeklySpent);
    document.getElementById('txt-weekly-limit').innerText = `$${formatCurrency(limitMax)}`;
    
    // Penalty Badge display
    const penaltyBadge = document.getElementById('penalty-badge');
    if (prevPenalty > 0) {
        penaltyBadge.style.display = 'inline-flex';
        document.getElementById('txt-penalty-amount').innerText = `-$${formatCurrency(prevPenalty)}`;
    } else {
        penaltyBadge.style.display = 'none';
    }

    // 8. Update Progress Bar Fill and Position Markers dynamically
    const pct = limitAllowance > 0 ? Math.min((totalWeeklySpent / limitAllowance) * 100, 100) : 0;
    const progressBarFill = document.getElementById('progress-bar-fill');
    progressBarFill.style.width = `${pct}%`;

    // Position markers according to adjusted limits
    if (limitAllowance > 0) {
        document.getElementById('marker-sano').style.left = `${(limitSano / limitAllowance) * 100}%`;
        document.getElementById('marker-tolerable').style.left = `${(limitTolerable / limitAllowance) * 100}%`;
        document.getElementById('marker-limit').style.left = `${(limitMax / limitAllowance) * 100}%`;
        document.getElementById('marker-max').style.left = '100%';
        
        document.getElementById('lbl-marker-sano').innerText = `$${Math.round(limitSano)}`;
        document.getElementById('lbl-marker-tolerable').innerText = `$${Math.round(limitTolerable)}`;
        document.getElementById('lbl-marker-limit').innerText = `$${Math.round(limitMax)}`;
        document.getElementById('lbl-marker-max').innerText = `$${Math.round(limitAllowance)}`;
    }

    // 9. Update Alert Status & Color Themes
    const dashboardSection = document.querySelector('.dashboard-section');
    const statusAlert = document.getElementById('status-alert');
    const statusAlertTitle = document.getElementById('status-alert-title');
    const statusAlertDesc = document.getElementById('status-alert-desc');
    const savingCardVal = document.getElementById('txt-estimated-savings');

    // Reset styles
    dashboardSection.classList.remove('state-green', 'state-tolerable', 'state-limit', 'state-buffer');
    progressBarFill.classList.remove('state-green', 'state-tolerable', 'state-limit', 'state-buffer');
    statusAlert.classList.remove('state-green-alert', 'state-tolerable-alert', 'state-limit-alert', 'state-buffer-alert');

    if (totalWeeklySpent <= limitSano) {
        dashboardSection.classList.add('state-green');
        progressBarFill.classList.add('state-green');
        statusAlert.classList.add('state-green-alert');
        statusAlert.querySelector('.alert-icon').className = 'fa-solid fa-circle-check alert-icon';
        statusAlertTitle.innerHTML = 'Gasto Sano 🟢';
        const rest = limitSano - totalWeeklySpent;
        statusAlertDesc.innerHTML = `¡Excelente! Estás en presupuesto óptimo. Te quedan <strong>$${formatCurrency(rest)}</strong> en zona verde de ahorro.`;
    } else if (totalWeeklySpent <= limitTolerable) {
        dashboardSection.classList.add('state-tolerable');
        progressBarFill.classList.add('state-tolerable');
        statusAlert.classList.add('state-tolerable-alert');
        statusAlert.querySelector('.alert-icon').className = 'fa-solid fa-circle-exclamation alert-icon';
        statusAlertTitle.innerHTML = 'Gasto Tolerable 🟡';
        const rest = limitTolerable - totalWeeklySpent;
        statusAlertDesc.innerHTML = `Estás en zona tolerable. Tienes <strong>$${formatCurrency(rest)}</strong> antes de llegar a tu límite quincenal libre.`;
    } else if (totalWeeklySpent <= limitMax) {
        dashboardSection.classList.add('state-limit');
        progressBarFill.classList.add('state-limit');
        statusAlert.classList.add('state-limit-alert');
        statusAlert.querySelector('.alert-icon').className = 'fa-solid fa-triangle-exclamation alert-icon';
        statusAlertTitle.innerHTML = 'Zona Límite 🔴';
        const rest = limitMax - totalWeeklySpent;
        statusAlertDesc.innerHTML = `¡Cuidado! Te quedan <strong>$${formatCurrency(rest)}</strong> antes de agotar tus libres y empezar a gastar tu propina semanal.`;
    } else if (totalWeeklySpent <= limitAllowance) {
        dashboardSection.classList.add('state-buffer');
        progressBarFill.classList.add('state-buffer');
        statusAlert.classList.add('state-buffer-alert');
        statusAlert.querySelector('.alert-icon').className = 'fa-solid fa-vault alert-icon';
        statusAlertTitle.innerHTML = 'Usando Colchón de Propinas 🟣';
        const rest = limitAllowance - totalWeeklySpent;
        statusAlertDesc.innerHTML = `Agotaste tu sueldo libre quincenal. Estás consumiendo la propina semanal. Te quedan <strong>$${formatCurrency(rest)}</strong> de amortiguación antes de penalizar la siguiente semana.`;
    } else {
        dashboardSection.classList.add('state-limit');
        progressBarFill.classList.add('state-limit');
        statusAlert.classList.add('state-limit-alert');
        statusAlert.querySelector('.alert-icon').className = 'fa-solid fa-circle-radiation alert-icon';
        statusAlertTitle.innerHTML = '¡Presupuesto Excedido! ⚠️';
        const over = totalWeeklySpent - limitAllowance;
        statusAlertDesc.innerHTML = `¡Alerta crítica! Has superado el colchón de propina semanal por <strong>$${formatCurrency(over)}</strong>. Esta cantidad será restada de tu presupuesto la siguiente semana.`;
    }

    // 10. Update Quick Cards (Weekly Savings: Free + Tips Buffer)
    const estimatedWeeklySavings = Math.max(0, limitAllowance - totalWeeklySpent);
    savingCardVal.innerText = `$${formatCurrency(estimatedWeeklySavings)}`;
    savingCardVal.className = 'card-val highlight';
    if (estimatedWeeklySavings <= 0) {
        savingCardVal.classList.add('critical');
    } else if (estimatedWeeklySavings < WEEKLY_TIPS_BUFFER) {
        savingCardVal.classList.add('warning');
    }

    const tipsElem = document.getElementById('txt-accumulated-tips');
    if (tipsElem) {
        tipsElem.innerText = `$${formatCurrency(totalTipsSaved)}`;
    }

    // 11. Render Transaction List
    const listContainer = document.getElementById('expense-list-container');
    listContainer.innerHTML = ''; // Clear

    if (weekExpenses.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-circle-info empty-icon"></i>
                <p>No hay gastos registrados en esta semana.</p>
                <p class="empty-sub">¡Tu saldo libre de esta semana está intacto!</p>
            </div>
        `;
    } else {
        // Sort newest first
        const sortedExpenses = [...weekExpenses].sort((a, b) => b.id - a.id);
        
        sortedExpenses.forEach(exp => {
            const expItem = document.createElement('div');
            expItem.className = 'expense-item';
            
            const dateObj = parseLocalDate(exp.date);
            const dateFormatted = dateObj.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });
            
            expItem.innerHTML = `
                <div class="expense-meta">
                    <div class="expense-cat-icon" title="${categoryNames[exp.category]}">
                        ${categoryIcons[exp.category] || '📦'}
                    </div>
                    <div class="expense-details">
                        <span class="expense-desc">${escapeHTML(exp.desc)}</span>
                        <span class="expense-date-cat">
                            ${dateFormatted} 
                            <span class="bullet-separator">•</span> 
                            ${categoryNames[exp.category]}
                        </span>
                    </div>
                </div>
                <div class="expense-action-area">
                    <span class="expense-amount-display">$${formatCurrency(exp.amount)}</span>
                    <button class="btn-delete-expense" data-id="${exp.id}" aria-label="Eliminar gasto">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            `;
            listContainer.appendChild(expItem);
        });

        // Add event listeners to delete buttons
        document.querySelectorAll('.btn-delete-expense').forEach(btn => {
            btn.addEventListener('click', function() {
                const idToDelete = parseInt(this.getAttribute('data-id'));
                deleteExpense(idToDelete);
            });
        });
    }
}

// Action Handlers
function addExpense(amount, desc, category, dateStr) {
    const newExpense = {
        id: Date.now(), // simple unique id
        amount: parseFloat(amount),
        desc: desc,
        category: category,
        date: dateStr
    };
    state.expenses.push(newExpense);
    saveToLocalStorage();
    updateUI();
}

// Helper for Custom Confirm and Alert modals
function showCustomConfirm(title, message, onConfirm, isAlertOnly = false) {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-desc').innerText = message;
    
    const btnConfirm = document.getElementById('modal-btn-confirm');
    const btnCancel = document.getElementById('modal-btn-cancel');
    const modalIcon = modal.querySelector('.modal-icon i');

    if (isAlertOnly) {
        btnCancel.style.display = 'none';
        btnConfirm.innerText = 'Entendido';
        modalIcon.className = 'fa-solid fa-circle-info';
    } else {
        btnCancel.style.display = 'block';
        btnConfirm.innerText = 'Aceptar';
        modalIcon.className = 'fa-solid fa-circle-question';
    }

    modal.style.display = 'flex';

    // Cleanup listeners using element cloning
    const cleanup = () => {
        modal.style.display = 'none';
        btnConfirm.replaceWith(btnConfirm.cloneNode(true));
        btnCancel.replaceWith(btnCancel.cloneNode(true));
    };

    document.getElementById('modal-btn-confirm').addEventListener('click', () => {
        if (onConfirm) onConfirm();
        cleanup();
    });

    document.getElementById('modal-btn-cancel').addEventListener('click', () => {
        cleanup();
    });
}

function deleteExpense(id) {
    showCustomConfirm(
        '¿Eliminar Gasto?',
        '¿Estás seguro de que deseas eliminar este gasto de tu historial?',
        () => {
            state.expenses = state.expenses.filter(exp => exp.id !== id);
            saveToLocalStorage();
            updateUI();
        }
    );
}

function clearActiveWeekExpenses() {
    const range = getWeekRange(state.activeWeekMonday);
    const count = state.expenses.filter(exp => {
        const d = parseLocalDate(exp.date);
        return d >= range.start && d <= range.end;
    }).length;

    if (count === 0) return;

    showCustomConfirm(
        '¿Limpiar Semana?',
        `¿Estás seguro de que deseas borrar los ${count} gastos registrados en la semana seleccionada?`,
        () => {
            state.expenses = state.expenses.filter(exp => {
                const d = parseLocalDate(exp.date);
                return d < range.start || d > range.end;
            });
            saveToLocalStorage();
            updateUI();
        }
    );
}

// Utilities
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// Export / Import functionality
function exportBackup() {
    if (state.expenses.length === 0) {
        showCustomConfirm('Exportación Vacía', 'No hay gastos registrados en la base de datos para exportar.', null, true);
        return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state.expenses, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `respaldo_gastos_${formatDateString(new Date())}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

function importBackup(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (Array.isArray(imported)) {
                showCustomConfirm(
                    '¿Importar Respaldo?',
                    `Se han encontrado ${imported.length} gastos. ¿Deseas importarlos y reemplazar tu historial actual?`,
                    () => {
                        state.expenses = imported;
                        saveToLocalStorage();
                        updateUI();
                        showCustomConfirm('Importación Éxito', 'Tus gastos se han importado y guardado correctamente.', null, true);
                    }
                );
            } else {
                showCustomConfirm('Error de Archivo', 'El archivo no tiene el formato de gastos correcto.', null, true);
            }
        } catch (err) {
            showCustomConfirm('Error de Lectura', 'Hubo un error al procesar el archivo JSON.', null, true);
            console.error(err);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// Initialization and Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // 0. Register Service Worker for PWA Offline Support
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registrado con éxito', reg))
            .catch(err => console.error('Error registrando Service Worker', err));
    }

    // 1. Initialize Active Week
    state.activeWeekMonday = getMonday(new Date());

    // 2. Set Default Date Input to Today
    const inputDate = document.getElementById('input-date');
    if (inputDate) {
        inputDate.value = formatDateString(new Date());
    }

    // 3. Load DB & Auto-clean older weeks
    loadFromLocalStorage();
    pruneOldExpenses();

    // 4. Initialize Theme
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme) {
        state.theme = storedTheme;
        if (state.theme === 'light') {
            document.body.classList.add('light-theme');
            const themeIcon = document.querySelector('#btn-theme-toggle i');
            if (themeIcon) themeIcon.className = 'fa-solid fa-sun';
        }
    }

    // 5. Update DOM
    updateUI();

    // 6. Bind Events
    // Form Submission
    const form = document.getElementById('expense-form');
    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            const amount = document.getElementById('input-amount').value;
            const desc = document.getElementById('input-desc').value;
            const category = document.getElementById('select-category').value;
            const date = document.getElementById('input-date').value;
            
            addExpense(amount, desc, category, date);
            
            // Reset input values
            document.getElementById('input-amount').value = '';
            document.getElementById('input-desc').value = '';
            document.getElementById('input-date').value = formatDateString(new Date());
        });
    }

    // Week Nav Buttons
    document.getElementById('btn-prev-week').addEventListener('click', () => {
        state.activeWeekMonday.setDate(state.activeWeekMonday.getDate() - 7);
        updateUI();
    });

    document.getElementById('btn-next-week').addEventListener('click', () => {
        state.activeWeekMonday.setDate(state.activeWeekMonday.getDate() + 7);
        updateUI();
    });

    // Clear Week Button
    document.getElementById('btn-clear-week').addEventListener('click', clearActiveWeekExpenses);

    // Export & Import Buttons
    document.getElementById('btn-export').addEventListener('click', exportBackup);
    
    const importInput = document.getElementById('input-import-file');
    document.getElementById('btn-import').addEventListener('click', () => {
        importInput.click();
    });
    importInput.addEventListener('change', importBackup);

    // Theme Toggle Button
    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
        const themeIcon = document.querySelector('#btn-theme-toggle i');
        if (document.body.classList.contains('light-theme')) {
            document.body.classList.remove('light-theme');
            state.theme = 'dark';
            if (themeIcon) themeIcon.className = 'fa-solid fa-moon';
        } else {
            document.body.classList.add('light-theme');
            state.theme = 'light';
            if (themeIcon) themeIcon.className = 'fa-solid fa-sun';
        }
        localStorage.setItem('theme', state.theme);
    });
});
